import RNFS from 'react-native-fs'
import { NativeModules } from 'react-native'

import { getLyricInfo, getPicPath } from '@/core/music'
import { handleGetOnlineMusicUrl } from '@/core/music/utils'
import { getData, saveData } from '@/plugins/storage'
import settingState from '@/store/setting/state'
import { log } from '@/utils/log'
import {
  downloadFile,
  existsFile,
  externalStorageDirectoryPath,
  getFSInfo,
  mkdir,
  moveFile,
  stat,
  stopDownload,
  temporaryDirectoryPath,
  unlink,
  writeFile,
} from '@/utils/fs'
import { scanFile, writeLyric, writeMetadata, writePic } from '@/utils/localMediaMetadata'
import { requestStoragePermission } from '@/utils/tools'
import {
  cleanupDownloadLogs,
  installCrashHandler,
  setDownloadLogEnabled,
  writeDownloadLog,
} from './logger'

export {
  clearDownloadLogs,
  flushDownloadLogs,
  getDownloadLogSize,
  isDownloadLogEnabled,
  readRecentLogs,
  setDownloadLogEnabled,
} from './logger'

export type DownloadTaskStatus = 'waiting' | 'downloading' | 'paused' | 'done' | 'error'
export type DownloadStage = 'preparing' | 'downloading' | 'tagging' | 'retrying' | ''
/**
 * 歌词落地结果，用于「重下失败歌词」定位需要补的任务
 * - ok：已写入 .lrc
 * - missing：音源没返回歌词
 * - fail：获取或写入报错
 * - skip：下载时没开启歌词
 */
export type LyricState = 'ok' | 'missing' | 'fail' | 'skip' | ''

export interface DownloadTask {
  id: string
  musicInfo: LX.Music.MusicInfoOnline
  listId: string
  listName: string
  quality: LX.Quality
  requestedQuality: LX.AppSetting['download.quality']
  stage: DownloadStage
  ext: string
  status: DownloadTaskStatus
  progress: number
  downloaded: number
  total: number
  speed: number
  filePath: string
  fileName: string
  error: string
  warning: string
  retry: number
  createdAt: number
  /** 每次字段变化时自增，界面靠它做细粒度更新，避免整列表重渲染 */
  rev?: number
  /** 歌词结果，旧版本存下来的任务没有这个字段 */
  lyricState?: LyricState
}

export interface EnqueueOptions {
  listId?: string
  listName?: string
  quality?: LX.AppSetting['download.quality']
}

const STORAGE_KEY = '@download_tasks'
const MAX_TASKS = 500
/** 向音源请求下载地址的超时时间 */
const GET_URL_TIMEOUT = 45 * 1000
/** 下载过程中多久没有新数据就判定失败 */
const DOWNLOAD_IDLE_TIMEOUT = 60 * 1000

let tasks: DownloadTask[] = []
let inited = false
let isPaused = false
let running = 0
let emitTimer: ReturnType<typeof setTimeout> | null = null
let persistTimer: ReturnType<typeof setTimeout> | null = null

/** 正在执行的任务 id，防止同一任务被重复调度 */
const activeIds = new Set<string>()

const TRACE_MAX = 120
const traceLogs: string[] = []
const trace = (message: string) => {
  const line = `${new Date().toISOString().slice(11, 19)} ${message}`
  traceLogs.push(line)
  if (traceLogs.length > TRACE_MAX) traceLogs.shift()
  log.info('[download]', message)
  writeDownloadLog('info', 'engine', message)
}

/** 记录异常堆栈，Hermes 下 stack 才有定位价值，只留前几帧 */
const traceError = (prefix: string, err: any) => {
  const message = String(err?.message ?? err)
  const stack = typeof err?.stack === 'string' ? err.stack : ''
  const frames = stack
    .split('\n')
    .slice(1, 4)
    .map((line: string) => line.trim())
    .filter(Boolean)
    .join(' <- ')
  trace(`${prefix}: ${message}${frames ? ` @ ${frames}` : ''}`)
}

/** 引擎内部日志，用于真机排查问题时导出 */
export const getDownloadLogs = () => traceLogs.slice()

const jobIds = new Map<string, number>()

const listeners = new Set<() => void>()

export const subscribeDownload = (listener: () => void) => {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

const emit = () => {
  listeners.forEach(listener => {
    try {
      listener()
    } catch (err) {
      log.error(err as Error)
    }
  })
}

const emitThrottled = () => {
  if (emitTimer) return
  emitTimer = setTimeout(() => {
    emitTimer = null
    emit()
  }, 500)
}

/**
 * 标记任务已变化并通知界面。
 * rev 是给 hook 做细粒度 diff 用的：只要 rev 没变，任务快照就复用旧对象，
 * memo 的列表项就不会重渲染，500 首任务时也不会每次进度都重画整片列表。
 */
const commit = (task: DownloadTask) => {
  task.rev = (task.rev ?? 0) + 1
  emit()
}

const commitThrottled = (task: DownloadTask) => {
  task.rev = (task.rev ?? 0) + 1
  emitThrottled()
}

export const getDownloadTasks = () => tasks

const delay = async(ms: number) => new Promise(resolve => setTimeout(resolve, ms))

const joinPath = (...parts: string[]) => parts
  .filter(part => part != null && part !== '')
  .map((part, index) => index === 0 ? part.replace(/\/+$/, '') : part.replace(/^\/+/, '').replace(/\/+$/, ''))
  .join('/')

export const sanitizeName = (name: string) => {
  const result = String(name ?? '')
    .replace(/[\\/:*?"<>|\r\n\t]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/, '')
  return result.slice(0, 80) || '未知歌曲'
}

/** 命名模板占位符 */
export const FILE_NAME_TOKENS = ['{歌名}', '{歌手}', '{专辑}', '{音轨号}', '{年份}'] as const

const getMetaText = (musicInfo: LX.Music.MusicInfoOnline, key: string) => {
  const meta = musicInfo.meta as unknown as Record<string, unknown>
  const value = meta?.[key]
  if (value == null) return ''
  return String(value)
}

const getYear = (musicInfo: LX.Music.MusicInfoOnline) => {
  const year = getMetaText(musicInfo, 'year')
  if (year) return year.slice(0, 4)
  const date = getMetaText(musicInfo, 'releaseDate') || getMetaText(musicInfo, 'date')
  return date ? date.slice(0, 4) : ''
}

const getTrackNumber = (musicInfo: LX.Music.MusicInfoOnline) => {
  const track = getMetaText(musicInfo, 'trackNumber') || getMetaText(musicInfo, 'track')
  return track ? track.replace(/^0+(?=\d)/, '') : ''
}

export const buildFileName = (
  musicInfo: LX.Music.MusicInfoOnline,
  type: LX.AppSetting['download.fileName'],
  template?: string,
) => {
  const name = sanitizeName(musicInfo.name)
  const singer = sanitizeName(musicInfo.singer)
  switch (type) {
    case '歌名 - 歌手':
      return `${name} - ${singer}`
    case '歌名':
      return name
    case '自定义': {
      const tpl = template?.trim() ?? ''
      const finalTpl = tpl === '' ? '{歌手} - {歌名}' : tpl
      const replaced = finalTpl
        .replace(/\{歌名\}|\{title\}/gi, name)
        .replace(/\{歌手\}|\{artist\}/gi, singer)
        .replace(/\{专辑\}|\{album\}/gi, sanitizeName(getMetaText(musicInfo, 'albumName')))
        .replace(/\{音轨号\}|\{track\}/gi, getTrackNumber(musicInfo))
        .replace(/\{年份\}|\{year\}/gi, getYear(musicInfo))
      return sanitizeName(replaced)
    }
    case '歌手 - 歌名':
    default:
      return `${singer} - ${name}`
  }
}

const QUALITY_CHAIN: Record<string, LX.Quality[]> = {
  flac24bit: ['flac24bit', 'flac', '320k', '128k'],
  flac: ['flac', '320k', '128k'],
  '320k': ['320k', '128k'],
  '128k': ['128k'],
  auto: ['flac24bit', 'flac', '320k', '128k'],
}

export const getQualityCandidates = (quality: LX.AppSetting['download.quality']): LX.Quality[] => {
  return QUALITY_CHAIN[quality] ?? QUALITY_CHAIN['320k']
}

const isQualityAvailable = (musicInfo: LX.Music.MusicInfoOnline, quality: LX.Quality) => {
  const qualitys = musicInfo.meta?._qualitys
  if (qualitys && Object.keys(qualitys).length && !qualitys[quality]) return false
  const qualityList = global.lx?.qualityList
  const sourceQualitys = qualityList ? qualityList[musicInfo.source] : undefined
  if (sourceQualitys?.length && !sourceQualitys.includes(quality)) return false
  return true
}

export const isMp3Header = (bytes: ArrayLike<number>) => {
  if (bytes.length >= 3 && bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) return true
  return bytes.length >= 2 && bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0
}

const isFlacHeader = (bytes: ArrayLike<number>) => {
  return bytes.length >= 4 && bytes[0] === 0x66 && bytes[1] === 0x4c && bytes[2] === 0x61 && bytes[3] === 0x43
}

const BASE64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

/**
 * 纯 JS 解析 base64 开头的若干字节。
 *
 * 这里刻意不用 Buffer：工程里 `@craftzdog/react-native-buffer@6` 依赖 quick-base64 v3，
 * 而原生只链接了 v2.2.2（v2 只有一个 install 方法，靠 JSI 注入全局函数），
 * 于是 v3 的 JS 调 `nativeModule.base64ToArrayBuffer` 会直接抛
 * "undefined is not a function"，把下载流程整个打断。
 */
export const base64ToBytes = (input: string, maxLength = 16): number[] => {
  const bytes: number[] = []
  if (!input) return bytes
  let buffer = 0
  let bits = 0
  for (let i = 0; i < input.length; i++) {
    const value = BASE64_CHARS.indexOf(input[i])
    if (value < 0) break
    buffer = (buffer << 6) | value
    bits += 6
    if (bits >= 8) {
      bits -= 8
      bytes.push((buffer >> bits) & 0xff)
      buffer &= (1 << bits) - 1
      if (bytes.length >= maxLength) break
    }
  }
  return bytes
}

/** 读取文件头判断真实格式，避免音源返回的格式与请求不符时把 FLAC 存成 .mp3 */
const detectFormat = async(filePath: string, fallbackExt: string) => {
  let head = ''
  try {
    head = await RNFS.read(filePath, 32, 0, 'base64')
  } catch (err: any) {
    trace(`detectFormat read failed: ${String(err?.message ?? err)}`)
    return fallbackExt
  }
  const bytes = base64ToBytes(head, 8)
  if (isFlacHeader(bytes)) return 'flac'
  if (isMp3Header(bytes)) return 'mp3'
  // 识别不出就按请求的音质推断，不要因为文件头异常把已经下载好的文件丢掉
  return fallbackExt
}

const existsNonEmpty = async(filePath: string) => {
  if (!await existsFile(filePath)) return false
  try {
    return (await stat(filePath)).size > 0
  } catch {
    return false
  }
}

const findExistingFile = async(dir: string, baseName: string) => {
  for (const ext of ['mp3', 'flac']) {
    const filePath = joinPath(dir, `${baseName}.${ext}`)
    if (await existsNonEmpty(filePath)) return filePath
  }
  return ''
}

const getUniquePath = async(dir: string, baseName: string, ext: string) => {
  let filePath = joinPath(dir, `${baseName}.${ext}`)
  let index = 2
  while (await existsFile(filePath)) {
    filePath = joinPath(dir, `${baseName} (${index}).${ext}`)
    index++
  }
  return filePath
}

const withTimeout = async<T>(promise: Promise<T>, timeout: number, message: string): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | null = null
  const timeoutPromise = new Promise<never>((resolve, reject) => {
    timer = setTimeout(() => { reject(new Error(message)) }, timeout)
  })
  try {
    return await Promise.race([promise, timeoutPromise])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

interface ParsedLyricLine {
  prefix: string
  text: string
}

const parseLrc = (lrc: string): ParsedLyricLine[] => {
  const lines: ParsedLyricLine[] = []
  for (const line of lrc.split(/\r?\n/)) {
    const match = line.match(/^(\[[^\]]+\])\s*(.*)$/)
    if (!match) continue
    lines.push({ prefix: match[1], text: match[2] })
  }
  return lines
}

/** 把翻译、罗马音按时间轴并到主歌词后面，同一时间戳输出多行 */
export const mergeLyric = (lyric: string, tlyric: string, rlyric: string, withT: boolean, withR: boolean) => {
  const main = parseLrc(lyric)
  if (!main.length) return lyric
  const tMap = new Map<string, string>()
  const rMap = new Map<string, string>()
  if (withT && tlyric) {
    parseLrc(tlyric).forEach(line => { if (line.text) tMap.set(line.prefix, line.text) })
  }
  if (withR && rlyric) {
    parseLrc(rlyric).forEach(line => { if (line.text) rMap.set(line.prefix, line.text) })
  }
  const out: string[] = []
  for (const line of main) {
    out.push(`${line.prefix}${line.text}`)
    const t = tMap.get(line.prefix)
    if (t) out.push(`${line.prefix}${t}`)
    const r = rMap.get(line.prefix)
    if (r) out.push(`${line.prefix}${r}`)
  }
  return out.join('\n')
}

/** 逐级创建目录：原生的 mkdir 只创建最后一级，父目录不存在时会直接失败 */
const ensureDirectory = async(path: string) => {
  if (!path) return
  try {
    if (await existsFile(path)) return
  } catch {}
  const parent = path.slice(0, path.lastIndexOf('/'))
  if (parent && parent !== path) await ensureDirectory(parent)
  try {
    await mkdir(path)
  } catch (err) {
    let existed = false
    try { existed = await existsFile(path) } catch {}
    if (!existed) throw err
  }
}

/** 音频旁的歌词文件路径，替换最后一段扩展名，兼容 flac/mp3/m4a 等 */
export const getLyricPath = (filePath: string) => filePath.replace(/\.[^./\\]+$/, '') + '.lrc'

interface LyricWriteResult {
  state: LyricState
  error: string
}

/**
 * 拉取并写入歌词。
 * 不抛异常，把结果作为返回值交出去：下载流程拿它记 warning，重下流程拿它做统计。
 */
const writeTaskLyric = async(task: DownloadTask, isRefresh = false): Promise<LyricWriteResult> => {
  const setting = settingState.setting
  try {
    const lyricInfo = await withTimeout(
      getLyricInfo({ musicInfo: task.musicInfo, isRefresh }),
      20 * 1000,
      '歌词获取超时',
    )
    const lyric = lyricInfo?.lyric?.trim() ?? ''
    if (!lyric) return { state: 'missing', error: '' }
    const merged = mergeLyric(
      lyric,
      lyricInfo.tlyric?.trim() ?? '',
      lyricInfo.rlyric?.trim() ?? '',
      setting['download.isDownloadTLyric'],
      setting['download.isDownloadRLyric'],
    )
    await writeFile(getLyricPath(task.filePath), merged, 'utf8')
    if (setting['download.isEmbedLyric']) await writeLyric(task.filePath, merged)
    return { state: 'ok', error: '' }
  } catch (err: any) {
    traceError(`lyric ${task.musicInfo.name}`, err)
    return { state: 'fail', error: String(err?.message ?? err) }
  }
}

const writeTaskMetadata = async(task: DownloadTask) => {
  const setting = settingState.setting
  const musicInfo = task.musicInfo
  const warnings: string[] = []
  const meta: LX.Music.MusicInfoOnline['meta'] = musicInfo.meta ?? {}

  if (setting['download.isWriteMetadata']) {
    try {
      const payload = {
        name: musicInfo.name,
        singer: musicInfo.singer,
        albumName: meta.albumName ?? '',
        trackNumber: setting['download.isWriteExtraMetadata'] ? getTrackNumber(musicInfo) : '',
        year: setting['download.isWriteExtraMetadata'] ? getYear(musicInfo) : '',
        genre: setting['download.isWriteExtraMetadata'] ? getMetaText(musicInfo, 'genre') : '',
      } as unknown as Parameters<typeof writeMetadata>[1]
      await writeMetadata(task.filePath, payload, false)
    } catch (err: any) {
      warnings.push(`标签写入失败: ${String(err?.message ?? err)}`)
    }
  }

  if (setting['download.isDownloadPic']) {
    try {
      let picUrl = meta.picUrl
      if (!picUrl) picUrl = await getPicPath({ musicInfo, isRefresh: false })
      if (picUrl) {
        const picDir = joinPath(temporaryDirectoryPath, 'lxmusic_download_pic')
        await ensureDirectory(picDir)
        const picPath = joinPath(picDir, `${task.id.replace(/[^\w.-]/g, '_')}.jpg`)
        const picJob = downloadFile(picUrl, picPath)
        await withTimeout(picJob.promise, 20 * 1000, '封面下载超时')
        await writePic(task.filePath, picPath)
        await unlink(picPath).catch(() => {})
      }
    } catch (err: any) {
      warnings.push(`封面写入失败: ${String(err?.message ?? err)}`)
    }
  }

  if (setting['download.isDownloadLyric']) {
    const result = await writeTaskLyric(task, false)
    task.lyricState = result.state
    if (result.error) warnings.push(`歌词写入失败: ${result.error}`)
  } else {
    task.lyricState = 'skip'
  }

  task.warning = [...new Set([task.warning, ...warnings].filter(Boolean))].join('；')
}

const downloadToFile = async(task: DownloadTask, url: string, filePath: string) => {
  await unlink(filePath).catch(() => {})
  let lastTick = Date.now()
  let lastBytes = 0
  let lastTime = Date.now()
  const job = downloadFile(url, filePath, {
    progressInterval: 500,
    connectionTimeout: 30 * 1000,
    readTimeout: DOWNLOAD_IDLE_TIMEOUT,
    progress: (res) => {
      lastTick = Date.now()
      task.downloaded = res.bytesWritten
      task.total = res.contentLength > 0 ? res.contentLength : 0
      task.progress = task.total > 0 ? Math.min(1, res.bytesWritten / task.total) : 0
      const now = Date.now()
      if (now - lastTime >= 500) {
        task.speed = Math.max(0, (res.bytesWritten - lastBytes) / ((now - lastTime) / 1000))
        lastBytes = res.bytesWritten
        lastTime = now
      }
      commitThrottled(task)
    },
  })
  // downloadFile 是对 RNFS 的封装，结构不对就直接给出可读的错误，而不是等到解构时才炸
  if (!job || typeof job !== 'object' || !(job as any).promise) {
    throw new Error('下载模块不可用：RNFS.downloadFile 未返回任务对象')
  }
  const { jobId, promise } = job
  jobIds.set(task.id, jobId)

  let watchdog: ReturnType<typeof setInterval> | null = null
  const idlePromise = new Promise<never>((resolve, reject) => {
    watchdog = setInterval(() => {
      if (Date.now() - lastTick < DOWNLOAD_IDLE_TIMEOUT) return
      try { stopDownload(jobId) } catch {}
      reject(new Error(`下载超时：${Math.round(DOWNLOAD_IDLE_TIMEOUT / 1000)} 秒没有收到数据`))
    }, 3000)
  })

  try {
    await Promise.race([promise, idlePromise])
  } finally {
    if (watchdog) clearInterval(watchdog)
    jobIds.delete(task.id)
  }
}

let storagePermissionAsked = false
const ensureStoragePermission = async() => {
  if (storagePermissionAsked) return
  storagePermissionAsked = true
  try {
    const granted = await requestStoragePermission()
    if (granted !== true) trace(`storage permission not granted: ${String(granted)}`)
  } catch (err: any) {
    trace(`storage permission error: ${String(err?.message ?? err)}`)
  }
}

const ensureDir = async(listName: string) => {
  await ensureStoragePermission()
  const sub = sanitizeName(listName)
  const publicRoot = externalStorageDirectoryPath || RNFS.ExternalStorageDirectoryPath
  const candidates = [
    { dir: joinPath(publicRoot, 'Download', 'LXMusic', sub), warning: '' },
    { dir: joinPath(RNFS.ExternalDirectoryPath, 'Download', 'LXMusic', sub), warning: '公共目录不可写，已改存到应用私有目录（Android/data）' },
    { dir: joinPath(RNFS.DocumentDirectoryPath, 'Download', 'LXMusic', sub), warning: '应用私有目录不可写，已改存到应用文档目录' },
  ].filter(item => !!item.dir)

  let lastError: any = null
  for (const item of candidates) {
    try {
      await ensureDirectory(item.dir)
      return { dir: item.dir, warning: item.warning }
    } catch (err: any) {
      lastError = err
      trace(`mkdir failed: ${item.dir} -> ${String(err?.message ?? err)}`)
    }
  }
  throw lastError ?? new Error('创建下载目录失败')
}

const downloadOneTask = async(task: DownloadTask) => {
  const setting = settingState.setting
  // 失败时把出错步骤带出去，真机上只看一句 message 根本无法定位
  let step = '准备目录'
  try {
    await runDownloadSteps(task, setting, (name) => { step = name })
  } catch (err: any) {
    if (err && typeof err === 'object') err.step = err.step ?? step
    throw err
  }
}

const runDownloadSteps = async(
  task: DownloadTask,
  setting: typeof settingState.setting,
  setStep: (name: string) => void,
) => {
  setStep('准备目录')
  const { dir, warning } = await ensureDir(task.listName)
  if (warning) task.warning = warning

  const baseName = buildFileName(task.musicInfo, setting['download.fileName'], setting['download.fileNameTemplate'])

  if (setting['download.isSkipExist']) {
    setStep('检查已存在文件')
    const existing = await findExistingFile(dir, baseName)
    if (existing) {
      const size = (await stat(existing)).size
      task.filePath = existing
      task.ext = existing.slice(existing.lastIndexOf('.') + 1)
      task.fileName = existing.slice(existing.lastIndexOf('/') + 1)
      task.total = size
      task.downloaded = size
      task.progress = 1
      task.warning = [task.warning, '已存在同名文件，已跳过'].filter(Boolean).join('；')
      return
    }
  }

  const requested = task.requestedQuality || setting['download.quality']
  const candidates = getQualityCandidates(requested)
  let lastError: any = null

  for (const quality of candidates) {
    // 暂停后不要继续尝试下一个音质，否则用户点了暂停仍会偷偷下载
    if ((task.status as string) === 'paused') throw new Error('已暂停')
    if (!isQualityAvailable(task.musicInfo, quality)) {
      lastError = new Error(`音源不支持 ${quality} 音质`)
      continue
    }

    task.stage = 'preparing'
    task.error = ''
    task.progress = 0
    task.downloaded = 0
    task.total = 0
    task.speed = 0
    commit(task)

    const partPath = `${joinPath(dir, baseName)}.${quality}.part`

    try {
      setStep(`获取下载地址(${quality})`)
      const result = await withTimeout(
        handleGetOnlineMusicUrl({
          musicInfo: task.musicInfo,
          quality,
          isRefresh: false,
          allowToggleSource: false,
          onToggleSource: () => {},
        }),
        GET_URL_TIMEOUT,
        `获取下载地址超时（${Math.round(GET_URL_TIMEOUT / 1000)} 秒无响应，音质 ${quality}）`,
      )
      const url = result.url
      if (!url) {
        lastError = new Error('音源未返回下载地址')
        continue
      }
      trace(`got url (${quality} -> ${result.quality}) ${String(url).slice(0, 60)}...`)

      if ((task.status as string) === 'paused') throw new Error('已暂停')
      task.stage = 'downloading'
      commit(task)
      setStep(`下载文件(${quality})`)
      await downloadToFile(task, url, partPath)

      setStep('校验文件')
      const size = await stat(partPath).then(res => res.size).catch(() => 0)
      if (!size) {
        lastError = new Error('下载到的文件为空')
        continue
      }

      setStep('识别格式')
      const ext = await detectFormat(partPath, result.quality.startsWith('flac') ? 'flac' : 'mp3')
      trace(`downloaded ${quality} -> ${size} bytes, ext=${ext}`)

      const filePath = await getUniquePath(dir, baseName, ext)
      setStep('移动到目标目录')
      await moveFile(partPath, filePath)

      task.quality = result.quality
      task.ext = ext
      task.filePath = filePath
      task.fileName = filePath.slice(filePath.lastIndexOf('/') + 1)
      task.stage = 'tagging'
      setStep('写入标签/封面/歌词')
      commit(task)

      await writeTaskMetadata(task)

      if (setting['download.isScanMedia']) void scanFile(filePath).catch(() => {})

      task.stage = ''
      return
    } catch (err: any) {
      await unlink(partPath).catch(() => {})
      lastError = err
      log.error(err as Error)
    }
  }

  task.stage = ''
  throw lastError ?? new Error('没有可用的下载音质')
}

const getConcurrency = () => {
  const value = Number(settingState.setting['download.concurrent'])
  return Number.isFinite(value) ? Math.min(5, Math.max(1, value)) : 3
}

const getMaxRetry = () => {
  const value = Number(settingState.setting['download.maxRetry'])
  return Number.isFinite(value) ? Math.min(5, Math.max(0, value)) : 2
}

/** 读原生模块的网络类型；模块缺失或异常一律返回 unknown，按放行处理，不能把下载卡死 */
const getNetworkType = (): string => {
  try {
    const native = (NativeModules as any).NetworkType
    if (!native || typeof native.getType !== 'function') return 'unknown'
    return String(native.getType())
  } catch {
    return 'unknown'
  }
}

const isWifiOnlyEnabled = () => settingState.setting['download.isWifiOnly']

/** 仅 WiFi 开启时，只有 wifi / 有线 / 未知 才放行 */
const canDownloadNow = () => {
  if (!isWifiOnlyEnabled()) return true
  const type = getNetworkType()
  return type === 'wifi' || type === 'ethernet' || type === 'unknown'
}

let waitingForWifi = false
let wifiTimer: ReturnType<typeof setTimeout> | null = null

const watchWifi = () => {
  if (wifiTimer) return
  wifiTimer = setTimeout(() => {
    wifiTimer = null
    if (!waitingForWifi) return
    if (!canDownloadNow()) {
      watchWifi()
      return
    }
    waitingForWifi = false
    trace('wifi restored, resume')
    emit()
    pump()
  }, 3000)
}

/**
 * 环形游标：每次从上次停下的位置继续找，不再从头扫描。
 * 队列里有几百个 done 任务时，这个差别很明显。
 */
let waitCursor = 0

const nextWaitingTask = (): DownloadTask | null => {
  const length = tasks.length
  if (!length) return null
  if (waitCursor >= length) waitCursor = 0
  for (let scanned = 0; scanned < length; scanned++) {
    const index = (waitCursor + scanned) % length
    const task = tasks[index]
    if (task.status === 'waiting' && !activeIds.has(task.id)) {
      waitCursor = (index + 1) % length
      return task
    }
  }
  return null
}

/** 有新任务进入 waiting 或队列结构变化时调用，避免游标停在中间漏掉前面的任务 */
const resetCursor = () => {
  waitCursor = 0
}

const runTask = async(task: DownloadTask) => {
  const maxRetry = getMaxRetry()
  task.status = 'downloading'
  task.error = ''
  task.progress = 0
  task.downloaded = 0
  task.total = 0
  task.speed = 0
  task.stage = 'preparing'
  task.retry = 0
  commit(task)

  // 重试在任务内部完成：状态始终保持 downloading，
  // 避免回到 waiting 后被 pump 再次取走，造成同一任务并发执行、并发槽被占满
  for (;;) {
    try {
      await downloadOneTask(task)
      if ((task.status as string) === 'paused') return
      task.status = 'done'
      task.progress = 1
      task.retry = 0
      task.stage = ''
      task.speed = 0
      task.rev = (task.rev ?? 0) + 1
      trace(`done ${task.musicInfo.name} (${task.quality}, ${task.ext})`)
      return
    } catch (err: any) {
      task.stage = ''
      task.speed = 0
      if ((task.status as string) === 'paused') return
      // 中途网络切到移动数据：不消耗重试次数，直接把任务放回队列等 WiFi
      if (!canDownloadNow()) {
        task.status = 'waiting'
        task.retry = 0
        waitingForWifi = true
        trace(`wifi lost, requeue ${task.musicInfo.name}`)
        commit(task)
        watchWifi()
        return
      }
      const message = String(err?.message ?? err)
      const step = String(err?.step ?? '')
      task.error = step ? `[${step}] ${message}` : message
      if (task.retry < maxRetry) {
        task.retry++
        task.status = 'downloading'
        task.stage = 'retrying'
        traceError(`retry ${task.retry}/${maxRetry} ${task.musicInfo.name}${step ? ` [${step}]` : ''}`, err)
        commit(task)
        await delay(1500 * task.retry)
        if ((task.status as string) === 'paused') return
        continue
      }
      task.status = 'error'
      task.rev = (task.rev ?? 0) + 1
      traceError(`failed ${task.musicInfo.name}${step ? ` [${step}]` : ''}`, err)
      log.error(err as Error)
      return
    }
  }
}

const pump = () => {
  if (!inited) {
    trace('pump skipped: engine not inited')
    return
  }
  if (isPaused) {
    trace('pump skipped: paused')
    return
  }
  if (!canDownloadNow()) {
    if (!waitingForWifi) {
      waitingForWifi = true
      trace('paused: waiting for wifi')
      emit()
    }
    watchWifi()
    return
  }
  if (waitingForWifi) {
    waitingForWifi = false
    trace('wifi ready, continue')
  }
  const concurrency = getConcurrency()
  // 自愈：没有在途任务却还有并发计数，说明计数泄漏，纠正它，否则新任务永远排不上
  if (!activeIds.size && running !== 0) {
    trace(`pump self-heal: running ${running} -> 0`)
    running = 0
  }
  while (running < concurrency) {
    const task = nextWaitingTask()
    if (!task) return
    running++
    activeIds.add(task.id)
    trace(`start ${task.musicInfo.name} (running ${running}/${concurrency})`)
    void runTask(task).finally(() => {
      activeIds.delete(task.id)
      running = Math.max(0, running - 1)
      emit()
      persist()
      pump()
    })
  }
}

/** 设置里改完并发数后调用：新腾出的槽位立刻被用起来，不用等下一个任务结束 */
export const applyConcurrencyChange = () => {
  trace(`concurrency -> ${getConcurrency()}`)
  pump()
}

const persist = () => {
  if (persistTimer) return
  persistTimer = setTimeout(() => {
    persistTimer = null
    const data = tasks.slice(0, MAX_TASKS).map(task => ({
      ...task,
      status: task.status === 'downloading' ? 'waiting' : task.status,
      stage: '',
      progress: task.status === 'done' ? 1 : 0,
      speed: 0,
    }))
    void saveData(STORAGE_KEY, data).catch((err: any) => {
      traceError('persist failed', err)
    })
  }, 2000)
}

export const initDownload = async() => {
  if (inited) return
  inited = true
  setDownloadLogEnabled(settingState.setting['download.isSaveLog'])
  installCrashHandler()
  void cleanupDownloadLogs().then(result => {
    if (result.files) trace(`logs: ${result.files} file(s), ${Math.round(result.bytes / 1024)} KB`)
  }).catch(() => {})
  try {
    const saved = await getData<DownloadTask[]>(STORAGE_KEY)
    if (Array.isArray(saved)) {
      tasks = saved.map(task => ({
        ...task,
        status: task.status === 'downloading' ? 'waiting' : task.status,
        stage: '' as DownloadStage,
        progress: task.status === 'done' ? 1 : 0,
        retry: 0,
        speed: 0,
        error: '',
        rev: 0,
        requestedQuality: task.requestedQuality ?? settingState.setting['download.quality'],
        ext: task.ext ?? 'mp3',
      }))
    }
  } catch (err) {
    log.error(err as Error)
    trace(`init failed: ${String((err as any)?.message ?? err)}`)
  }
  trace(`init: ${tasks.length} task(s) restored, ${tasks.filter(task => task.status === 'waiting').length} waiting`)
  resetCursor()
  emit()
  if (tasks.some(task => task.status === 'waiting')) pump()
}

/** 按音质粗略估算每首体积，用于入队前的空间预检 */
const BYTES_PER_TRACK: Record<string, number> = {
  '128k': 4 * 1024 * 1024,
  '320k': 10 * 1024 * 1024,
  flac: 35 * 1024 * 1024,
  flac24bit: 55 * 1024 * 1024,
}

let lastSpaceInfo: { need: number, free: number } | null = null

/** 最近一次入队时的空间不足信息，调用方据此提示用户；够用时为 null */
export const getLastSpaceInfo = () => lastSpaceInfo

/** 只做提示不阻断：用户可能就是想先把队列排上，等清了空间再下 */
const checkSpace = async(count: number, quality: string) => {
  lastSpaceInfo = null
  const per = BYTES_PER_TRACK[quality] ?? BYTES_PER_TRACK['320k']
  const need = per * Math.max(1, count)
  try {
    const info = await getFSInfo()
    const free = Number(info?.freeSpace ?? 0)
    // free 为 0 通常意味着查询失败，此时不下结论
    if (free > 0 && free < need * 1.2) lastSpaceInfo = { need, free }
  } catch {
    lastSpaceInfo = null
  }
  if (lastSpaceInfo) {
    trace(`low space: need ${Math.round(lastSpaceInfo.need / 1048576)} MB, free ${Math.round(lastSpaceInfo.free / 1048576)} MB`)
  }
}

export const enqueueDownloads = async(list: LX.Music.MusicInfoOnline[], options: EnqueueOptions = {}) => {
  await initDownload()
  const listName = options.listName ?? '未分类'
  const requestedQuality = options.quality ?? settingState.setting['download.quality']
  let added = 0

  for (const musicInfo of list) {
    if (!musicInfo) continue
    const id = `${musicInfo.source}_${musicInfo.id}`
    const existed = tasks.find(task => task.id === id)

    if (existed) {
      if (existed.status === 'waiting' || existed.status === 'downloading' || existed.status === 'paused') continue
      if (existed.status === 'done' && existed.filePath && await existsFile(existed.filePath)) continue
      tasks = tasks.filter(task => task !== existed)
    }

    tasks.unshift({
      id,
      musicInfo,
      listId: options.listId ?? '',
      listName,
      quality: '128k',
      requestedQuality,
      stage: '',
      ext: 'mp3',
      status: 'waiting',
      progress: 0,
      downloaded: 0,
      total: 0,
      speed: 0,
      filePath: '',
      fileName: '',
      error: '',
      warning: '',
      retry: 0,
      createdAt: Date.now(),
      rev: 1,
    })
    added++
  }

  if (added) {
    if (tasks.length > MAX_TASKS) tasks = tasks.slice(0, MAX_TASKS)
    // 新任务入队说明用户想下载，此前若处于暂停状态则自动恢复，避免新任务永远排队
    if (isPaused) {
      isPaused = false
      tasks.forEach(task => {
        if ((task.status as string) === 'paused') task.status = 'waiting'
      })
      trace('auto resumed: new tasks enqueued')
    }
    trace(`enqueue ${added} task(s) from ${listName}`)
    await checkSpace(added, requestedQuality)
    resetCursor()
    emit()
    persist()
    pump()
  }
  return added
}

export const pauseAllDownloads = () => {
  isPaused = true
  trace('pause all')
  let paused = 0
  for (const task of tasks) {
    if (task.status !== 'downloading') continue
    task.status = 'paused'
    task.rev = (task.rev ?? 0) + 1
    paused++
  }
  for (const [, jobId] of jobIds) {
    try { stopDownload(jobId) } catch {}
  }
  trace(`paused ${paused} task(s)`)
  emit()
  persist()
}

export const resumeAllDownloads = () => {
  isPaused = false
  trace('resume all')
  tasks.forEach(task => {
    if (task.status === 'paused') {
      task.status = 'waiting'
      task.rev = (task.rev ?? 0) + 1
    }
  })
  resetCursor()
  emit()
  persist()
  pump()
}

export const retryDownload = (id: string) => {
  const task = tasks.find(item => item.id === id)
  if (!task) return
  task.status = 'waiting'
  task.retry = 0
  task.error = ''
  task.stage = ''
  isPaused = false
  resetCursor()
  commit(task)
  pump()
}

/**
 * 把所有失败任务一次性重新排队。
 * 只处理 status=error，不动 done / waiting / paused，避免误伤正在跑的队列。
 */
export const retryAllFailed = () => {
  const failed = tasks.filter(task => task.status === 'error')
  if (!failed.length) return 0
  for (const task of failed) {
    task.status = 'waiting'
    task.retry = 0
    task.error = ''
    task.stage = ''
    task.rev = (task.rev ?? 0) + 1
  }
  isPaused = false
  trace(`retry all failed: ${failed.length} task(s)`)
  resetCursor()
  emit()
  persist()
  pump()
  return failed.length
}

export const removeDownloadTask = (id: string, deleteFile = false) => {
  const task = tasks.find(item => item.id === id)
  if (!task) return
  if (jobIds.has(id)) {
    stopDownload(jobIds.get(id)!)
    jobIds.delete(id)
  }
  tasks = tasks.filter(item => item.id !== id)
  if (deleteFile && task.filePath) void unlink(task.filePath).catch(() => {})
  resetCursor()
  emit()
  persist()
}

export const clearCompletedDownloads = () => {
  tasks = tasks.filter(task => task.status !== 'done')
  resetCursor()
  emit()
  persist()
}

export const clearAllDownloads = () => {
  pauseAllDownloads()
  tasks = []
  resetCursor()
  emit()
  persist()
}

export interface LyricRetryStatus {
  running: boolean
  total: number
  done: number
  ok: number
  fail: number
}

export interface LyricRetryResult {
  /** 设置里关掉了歌词下载，直接返回，不做任何请求 */
  disabled: boolean
  total: number
  ok: number
  fail: number
}

let lyricRetry: LyricRetryStatus = { running: false, total: 0, done: 0, ok: 0, fail: 0 }

const patchLyricRetry = (patch: Partial<LyricRetryStatus>) => {
  lyricRetry = { ...lyricRetry, ...patch }
  emit()
}

/** 当前这轮「重下失败歌词」的进度，给下载页按钮用 */
export const getLyricRetryStatus = () => lyricRetry

/** 判断一首已完成的任务是不是缺歌词：以磁盘上的 .lrc 为准，比历史状态更可靠 */
const isLyricMissing = async(task: DownloadTask) => {
  if (task.status !== 'done' || !task.filePath) return false
  if (task.lyricState === 'skip') return false
  try {
    const lrcPath = getLyricPath(task.filePath)
    if (!await existsFile(lrcPath)) return true
    const info = await stat(lrcPath)
    return !(info.size > 0)
  } catch {
    return true
  }
}

/** 统计已完成但缺歌词的任务数，用于界面提示 */
export const countMissingLyrics = async() => {
  let count = 0
  for (const task of tasks) {
    if (await isLyricMissing(task)) count++
  }
  return count
}

/**
 * 把所有「已下载完成但歌词没落地」的任务重新拉一遍歌词。
 * 覆盖三种情况：音源当时没返回歌词、写入报错、旧版本下载时没有歌词状态记录。
 */
export const retryFailedLyrics = async(): Promise<LyricRetryResult> => {
  if (lyricRetry.running) {
    return { disabled: false, total: lyricRetry.total, ok: lyricRetry.ok, fail: lyricRetry.fail }
  }
  if (!inited) await initDownload()
  if (!settingState.setting['download.isDownloadLyric']) {
    return { disabled: true, total: 0, ok: 0, fail: 0 }
  }

  const targets: DownloadTask[] = []
  for (const task of tasks) {
    if (await isLyricMissing(task)) targets.push(task)
  }

  const result: LyricRetryResult = { disabled: false, total: targets.length, ok: 0, fail: 0 }
  if (!targets.length) return result

  trace(`lyric retry start: ${targets.length} task(s)`)
  patchLyricRetry({ running: true, total: targets.length, done: 0, ok: 0, fail: 0 })

  for (const task of targets) {
    const res = await writeTaskLyric(task, true)
    task.lyricState = res.state
    if (res.state === 'ok') {
      result.ok++
      // 把历史遗留的歌词失败提示从任务上抹掉，避免重下成功仍显示警告
      task.warning = task.warning.split('；').filter(line => line && !line.includes('歌词')).join('；')
    } else {
      result.fail++
    }
    patchLyricRetry({ done: lyricRetry.done + 1, ok: result.ok, fail: result.fail })
    await delay(120)
  }

  patchLyricRetry({ running: false })
  persist()
  trace(`lyric retry done: ok=${result.ok} fail=${result.fail}`)
  return result
}

/** 一次遍历统计，避免 500 个任务时连跑四遍 filter */
export const getDownloadStats = () => {
  let done = 0
  let error = 0
  let waiting = 0
  let downloading = 0
  for (const task of tasks) {
    if (task.status === 'done') done++
    else if (task.status === 'error') error++
    else if (task.status === 'downloading') downloading++
    else waiting++
  }
  return { total: tasks.length, done, error, waiting, downloading }
}

export interface EngineStatus {
  inited: boolean
  paused: boolean
  running: number
  concurrency: number
  activeIds: string[]
  /** 仅 WiFi 开启且当前不是 WiFi，调度器处于等待状态 */
  waitingForWifi: boolean
  network: string
}

/** 调度器内部状态，用于下载页排查「一直等待」这类问题 */
export const getEngineStatus = (): EngineStatus => ({
  inited,
  paused: isPaused,
  running,
  concurrency: getConcurrency(),
  activeIds: [...activeIds],
  waitingForWifi,
  network: getNetworkType(),
})
