import {
  appendFile,
  existsFile,
  mkdir,
  moveFile,
  privateStorageDirectoryPath,
  readDir,
  readFile,
  stat,
  unlink,
} from '@/utils/fs'

/* eslint-disable require-atomic-updates -- JS 单线程，写盘由 writing 锁串行化，这些赋值不存在真正的竞态 */

/**
 * 下载引擎的持久化日志。
 *
 * 目标很明确：App 被杀掉、崩溃、被系统回收之后，用户还能拿到出问题那一刻的现场。
 * 所以这里刻意做得很小：按天一个文件、单文件写满就轮转、总量封顶、超期自动删除。
 */

export type DownloadLogLevel = 'debug' | 'info' | 'warn' | 'error' | 'fatal'

const LOG_DIR = `${privateStorageDirectoryPath}/download-logs`
/** 单个日志文件上限，超过就轮转为 xxx.log.1 */
const MAX_FILE_BYTES = 256 * 1024
/** 整个日志目录上限，超了从最旧的删 */
const MAX_TOTAL_BYTES = 3 * 1024 * 1024
const KEEP_DAYS = 7
const FLUSH_DELAY = 1000
/** 内存里保留的条数，供「诊断」即时读取，不依赖磁盘 */
const MEMORY_MAX = 300
const BUFFER_MAX = 400

let buffer: string[] = []
let memory: string[] = []
let flushTimer: ReturnType<typeof setTimeout> | null = null
let dirReady = false
let currentSize = -1
let currentDate = ''
let writing = false
let enabled = true
let failureNoted = false

const two = (n: number) => n < 10 ? `0${n}` : String(n)
const three = (n: number) => n < 10 ? `00${n}` : n < 100 ? `0${n}` : String(n)

const stamp = (d: Date) => `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())} ${two(d.getHours())}:${two(d.getMinutes())}:${two(d.getSeconds())}.${three(d.getMilliseconds())}`
const dayKey = (d: Date) => `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`

const ensureDir = async() => {
  if (dirReady) return
  // 原生 mkdir 不递归，所以逐级确认；真实环境里父目录一定存在，只有首次会多一次判断
  if (!await existsFile(privateStorageDirectoryPath)) await mkdir(privateStorageDirectoryPath)
  if (!await existsFile(LOG_DIR)) await mkdir(LOG_DIR)
  dirReady = true
}

const resolvePath = async() => {
  const day = dayKey(new Date())
  if (day !== currentDate) {
    currentDate = day
    currentSize = -1
  }
  const path = `${LOG_DIR}/${day}.log`
  if (currentSize < 0) {
    try {
      currentSize = (await stat(path)).size
    } catch {
      currentSize = 0
    }
  }
  return path
}

const flushNow = async() => {
  if (writing || !buffer.length) return
  writing = true
  const chunk = buffer.join('\n') + '\n'
  buffer = []
  try {
    await ensureDir()
    const path = await resolvePath()
    if (currentSize + chunk.length > MAX_FILE_BYTES) {
      const archive = `${path}.1`
      await unlink(archive).catch(() => {})
      await moveFile(path, archive).catch(() => {})
      currentSize = 0
    }
    await appendFile(path, chunk, 'utf8')
    currentSize += chunk.length
  } catch {
    // 落盘失败不能影响下载主流程，退回内存缓冲，下次再试
    buffer = chunk.split('\n').filter(Boolean).slice(-BUFFER_MAX).concat(buffer).slice(-BUFFER_MAX)
    if (!failureNoted) {
      failureNoted = true
      memory.push(`${stamp(new Date())} [warn] [log] 日志无法写入磁盘，只保留在内存中`)
      if (memory.length > MEMORY_MAX) memory.shift()
    }
  } finally {
    writing = false
  }
}

const scheduleFlush = () => {
  if (flushTimer) return
  flushTimer = setTimeout(() => {
    flushTimer = null
    void flushNow()
  }, FLUSH_DELAY)
}

export const writeDownloadLog = (level: DownloadLogLevel, tag: string, message: string) => {
  if (!enabled) return
  const line = `${stamp(new Date())} [${level}] [${tag}] ${message}`
  memory.push(line)
  if (memory.length > MEMORY_MAX) memory.shift()
  buffer.push(line)
  if (buffer.length >= BUFFER_MAX || level === 'fatal') void flushNow()
  else scheduleFlush()
}

/** 内存日志，诊断时优先用它，能拿到还没落盘的最后几条 */
export const getMemoryLogs = () => memory.slice()

export const setDownloadLogEnabled = (value: boolean) => {
  enabled = value
  if (value) scheduleFlush()
}

export const isDownloadLogEnabled = () => enabled

export const flushDownloadLogs = async() => flushNow()

/** 清理超期与超量的日志，返回剩余情况 */
export const cleanupDownloadLogs = async() => {
  const empty = { files: 0, bytes: 0 }
  try {
    await ensureDir()
    const items = (await readDir(LOG_DIR))
      .filter(file => file.isFile && /\.log(\.\d+)?$/.test(file.name))
      .sort((a, b) => b.lastModified - a.lastModified)
    const now = Date.now()
    let total = 0
    let files = 0
    for (const item of items) {
      const expired = now - item.lastModified > KEEP_DAYS * 86400000
      const overflow = total + item.size > MAX_TOTAL_BYTES
      if (expired || overflow) {
        await unlink(item.path).catch(() => {})
        continue
      }
      total += item.size
      files++
    }
    return { files, bytes: total }
  } catch {
    return empty
  }
}

export const getDownloadLogSize = async() => {
  try {
    await ensureDir()
    const items = (await readDir(LOG_DIR)).filter(file => file.isFile && /\.log(\.\d+)?$/.test(file.name))
    return items.reduce((sum, file) => sum + file.size, 0)
  } catch {
    return 0
  }
}

/** 读最近若干行，用于「导出日志」 */
export const readRecentLogs = async(maxLines = 400) => {
  await flushNow()
  try {
    await ensureDir()
    const items = (await readDir(LOG_DIR))
      .filter(file => file.isFile && file.name.endsWith('.log'))
      .sort((a, b) => b.lastModified - a.lastModified)
    const parts: string[] = []
    for (const item of items.slice(0, 2)) {
      const text = await readFile(item.path, 'utf8')
      if (typeof text === 'string') parts.push(text)
      if (parts.join('').split('\n').length >= maxLines) break
    }
    return parts.join('').split('\n').filter(Boolean).slice(-maxLines).join('\n')
  } catch {
    return ''
  }
}

export const clearDownloadLogs = async() => {
  buffer = []
  memory = []
  try {
    await ensureDir()
    const items = await readDir(LOG_DIR)
    for (const item of items) {
      if (item.isFile) await unlink(item.path).catch(() => {})
    }
    currentSize = 0
    return true
  } catch {
    return false
  }
}

/** 装全局崩溃钩子：JS 崩溃时至少留下一条 FATAL，再交给原来的处理器 */
let crashHooked = false
export const installCrashHandler = () => {
  if (crashHooked) return
  const errorUtils = (globalThis as any).ErrorUtils
  if (!errorUtils?.setGlobalHandler) return
  crashHooked = true
  const previous = typeof errorUtils.getGlobalHandler === 'function' ? errorUtils.getGlobalHandler() : null
  errorUtils.setGlobalHandler((error: any, isFatal?: boolean) => {
    try {
      const stack = String(error?.stack ?? '')
      writeDownloadLog('fatal', 'crash', `${isFatal ? 'JS FATAL' : 'JS ERROR'} ${String(error?.message ?? error)}${stack ? `\n${stack}` : ''}`)
      void flushNow()
    } catch {}
    if (typeof previous === 'function') previous(error, isFatal)
  })
}
