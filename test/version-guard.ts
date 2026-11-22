/**
 * 「更新检查已关闭」的回归测试。
 *
 * 断言四件事：
 * 1. 三个底层函数全部拒绝，且错误码是 UPDATE_CHECK_DISABLED —— 任何路径都下载不到上游包
 * 2. checkUpdate() 不把状态改成「有新版本」，调用后是 idle / isLatest=true / newVersion=null
 * 3. 整个 src 目录（注释除外）不存在官方更新源地址
 * 4. globalData 仍然把 process.versions.app 设为纯上游版本号（UA 不受 -batch.N 影响）
 */
import fs from 'node:fs'
import path from 'node:path'
import { getVersionInfo, downloadNewVersion, updateApp } from '@/utils/version'
import versionState from '@/store/version/state'

const results: { name: string, ok: boolean, detail: string }[] = []
const check = (name: string, ok: boolean, detail = '') => {
  results.push({ name, ok, detail })
}

const expectReject = async(name: string, fn: () => Promise<unknown>) => {
  try {
    await fn()
    check(name, false, '未抛错，说明仍可能存在网络或安装路径')
  } catch (err: any) {
    check(name, err?.message === 'UPDATE_CHECK_DISABLED', `err=${err?.message}`)
  }
}

const BANNED = [
  'lx-music-mobile-version-info',
  'cdn.stsky.cn',
  'lx-music-mobile-versions',
  'publish/version.json',
  'releases/download',
  'raw.githubusercontent.com',
  'jsdelivr.net',
]

const scanSource = () => {
  const root = path.join(process.cwd(), 'src')
  const hits: string[] = []
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        walk(full)
        continue
      }
      if (!/\.(ts|tsx|js)$/.test(entry.name)) continue
      const lines = fs.readFileSync(full, 'utf8').split('\n')
      lines.forEach((line, i) => {
        const trimmed = line.trim()
        if (trimmed.startsWith('*') || trimmed.startsWith('//') || trimmed.startsWith('/*')) return
        for (const word of BANNED) {
          if (line.includes(word)) hits.push(`${path.relative(root, full)}:${i + 1} ${word}`)
        }
      })
    }
  }
  walk(root)
  return hits
}

const main = async() => {
  await expectReject('getVersionInfo 直接拒绝', () => getVersionInfo())
  await expectReject('downloadNewVersion 直接拒绝', () => downloadNewVersion())
  await expectReject('updateApp 直接拒绝', () => updateApp())

  // 动态导入：action.ts 依赖 global.state_event，先打好桩
  ;(global as any).state_event = {
    versionInfoUpdated: () => {},
    versionInfoIgnoreVersionUpdated: () => {},
    versionDownloadProgressUpdated: () => {},
  }
  const { checkUpdate, downloadUpdate } = await import('@/core/version')

  await checkUpdate()
  const info = versionState.versionInfo
  check('checkUpdate 后状态为 idle', info.status === 'idle', `status=${info.status}`)
  check('checkUpdate 后标记为最新', info.isLatest === true, `isLatest=${info.isLatest}`)
  check('checkUpdate 后无 newVersion', info.newVersion === null, `newVersion=${JSON.stringify(info.newVersion)}`)

  downloadUpdate()
  check('downloadUpdate 为空实现', versionState.versionInfo.status === 'idle', `status=${versionState.versionInfo.status}`)

  const hits = scanSource()
  check('src 内无官方更新源地址', hits.length === 0, hits.join(' | ') || 'clean')

  const globalData = fs.readFileSync(path.join(process.cwd(), 'src', 'config', 'globalData.ts'), 'utf8')
  check('UA 版本号来源未被改动', globalData.includes('process.versions.app = version'), 'globalData.ts')

  const failed = results.filter(r => !r.ok)
  for (const r of results) {
    console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.detail ? `  (${r.detail})` : ''}`)
  }
  console.log(`\n${results.length - failed.length}/${results.length} passed`)
  if (failed.length) process.exit(1)
}

void main()
