import fs from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'

import settingState from './mocks/settingState'
import { calls } from './mocks/metadata'
import { network } from './mocks/reactNative'
import {
  base64ToBytes,
  clearCompletedDownloads,
  countMissingLyrics,
  enqueueDownloads,
  flushDownloadLogs,
  getDownloadTasks,
  getEngineStatus,
  getLastSpaceInfo,
  getLyricPath,
  initDownload,
  isMp3Header,
  mergeLyric,
  pauseAllDownloads,
  readRecentLogs,
  removeDownloadTask,
  retryAllFailed,
  retryFailedLyrics,
  type DownloadTask,
} from '../src/core/download'

const root = process.env.TEST_DOWNLOAD_DIR!
const listDir = path.join(root, 'Download', 'LXMusic', '测试歌单')

const musicBase: any = {
  source: 'kw',
  interval: '04:29',
  meta: {
    songId: '228908',
    copyrightId: '60054701923',
    albumName: '叶惠美',
    picUrl: null,
    qualitys: [],
    _qualitys: {
      '320k': { size: '10.29M' },
      '128k': { size: '4.12M' },
    },
  },
}

const songs: any[] = [
  { ...musicBase, id: '228908', name: '晴天', singer: '周杰伦' },
  { ...musicBase, id: 'fallback-1', name: 'FLAC_FALLBACK', singer: '周杰伦' },
  { ...musicBase, id: 'fallback-2', name: 'NO_320', singer: '周杰伦' },
]

const waitForIdle = async(timeout = 300000) => {
  const start = Date.now()
  while (Date.now() - start < timeout) {
    const tasks = getDownloadTasks()
    if (tasks.length && tasks.every(task => task.status === 'done' || task.status === 'error')) return
    await new Promise(resolve => setTimeout(resolve, 500))
  }
  throw new Error('等待下载完成超时')
}

const findTask = (name: string): DownloadTask => {
  const task = getDownloadTasks().find(item => item.musicInfo.name === name)
  assert.ok(task, `找不到任务 ${name}`)
  return task
}

const readHead = (filePath: string, length = 4) => {
  const fd = fs.openSync(filePath, 'r')
  const buffer = Buffer.alloc(length)
  fs.readSync(fd, buffer, 0, length, 0)
  fs.closeSync(fd)
  return buffer
}

const main = async() => {
  fs.rmSync(root, { recursive: true, force: true })
  fs.mkdirSync(root, { recursive: true })

  ;(globalThis as any).lx = { qualityList: { kw: ['128k', '320k', 'flac', 'flac24bit'] } }

  // TC-07 歌词合并：纯函数先验证
  const merged = mergeLyric(
    '[00:00.00]原文1\n[00:01.00]原文2',
    '[00:00.00]翻译1\n[00:01.00]翻译2',
    '[00:00.00]roma1\n[00:01.00]roma2',
    true,
    true,
  )
  assert.equal(merged.split('\n').length, 6, '合并后应为 6 行')
  assert.ok(merged.includes('翻译1'), '应包含翻译')
  assert.ok(merged.includes('roma2'), '应包含罗马音')

  await initDownload()
  const added = await enqueueDownloads(songs, { listName: '测试歌单', listId: 'test-list' })
  assert.equal(added, 3, '应加入 3 个下载任务')
  await waitForIdle()

  // TC-01 320k 正常下载
  const normal = findTask('晴天')
  assert.equal(normal.status, 'done', `晴天下载失败: ${normal.error}`)
  assert.equal(normal.quality, '320k', '晴天应下载 320k')
  assert.equal(normal.ext, 'mp3', '320k 应保存为 mp3')
  assert.ok(normal.filePath.endsWith(path.join('测试歌单', '周杰伦 - 晴天.mp3')), `文件路径不符合预期: ${normal.filePath}`)
  assert.ok(fs.existsSync(normal.filePath), '音频文件不存在')
  assert.ok(readHead(normal.filePath, 3).toString() === 'ID3', '文件头应为 ID3')

  // TC-02 FLAC 原样保存，不转码
  const flacTask = findTask('FLAC_FALLBACK')
  assert.equal(flacTask.status, 'done', `FLAC 下载失败: ${flacTask.error}`)
  assert.equal(flacTask.ext, 'flac', 'FLAC 应原样保存为 .flac')
  assert.ok(flacTask.filePath.endsWith('.flac'), `扩展名应为 flac: ${flacTask.filePath}`)
  assert.equal(readHead(flacTask.filePath, 4).toString(), 'fLaC', '文件头应为 fLaC')

  // TC-03 无 320k 自动降级 128k
  const no320 = findTask('NO_320')
  assert.equal(no320.status, 'done', `无 320k 任务失败: ${no320.error}`)
  assert.equal(no320.quality, '128k', '无 320k 时应降级到 128k')
  assert.equal(no320.ext, 'mp3')

  // TC-04 歌词外挂 + 合并
  const lrcPath = normal.filePath.replace(/\.mp3$/, '.lrc')
  assert.ok(fs.existsSync(lrcPath), '歌词文件不存在')
  const lrc = fs.readFileSync(lrcPath, 'utf8')
  assert.ok(lrc.includes('测试歌词'), '歌词应包含原文')
  assert.ok(lrc.includes('测试翻译'), '歌词应包含翻译')
  assert.ok(lrc.includes('tesutokashi'), '歌词应包含罗马音')

  // TC-05 重复入队应被跳过
  const addedAgain = await enqueueDownloads([songs[0]], { listName: '测试歌单' })
  assert.equal(addedAgain, 0, '已完成且文件存在时不应重复入队')

  // TC-06 自定义命名模板
  settingState.setting['download.isSkipExist'] = false
  settingState.setting['download.fileName'] = '自定义'
  settingState.setting['download.fileNameTemplate'] = '{歌名}-{歌手}'
  settingState.setting['download.quality'] = '128k'
  await enqueueDownloads([{ ...musicBase, id: 'tpl', name: '模板测试', singer: '周杰伦' }], { listName: '测试歌单' })
  await waitForIdle()
  const tplTask = findTask('模板测试')
  assert.equal(tplTask.status, 'done', `模板命名任务失败: ${tplTask.error}`)
  assert.ok(tplTask.filePath.endsWith('模板测试-周杰伦.mp3'), `模板文件名不符合预期: ${tplTask.filePath}`)

  // TC-08 关闭全部元数据后不再写入
  settingState.setting['download.isWriteMetadata'] = false
  settingState.setting['download.isDownloadPic'] = false
  settingState.setting['download.isDownloadLyric'] = false
  settingState.setting['download.isScanMedia'] = false
  const before = calls.length
  await enqueueDownloads([{ ...musicBase, id: 'no-meta', name: '无标签测试', singer: '周杰伦' }], { listName: '测试歌单' })
  await waitForIdle()
  const noMeta = findTask('无标签测试')
  assert.equal(noMeta.status, 'done', `无标签任务失败: ${noMeta.error}`)
  assert.equal(calls.length, before, '关闭开关后仍写入了元数据')

  // TC-09 调度：入队后应立即离开 waiting 状态
  await enqueueDownloads([{ ...musicBase, id: 'sched', name: '调度测试', singer: '周杰伦' }], { listName: '测试歌单' })
  await new Promise(resolve => setTimeout(resolve, 300))
  const schedTask = findTask('调度测试')
  assert.notEqual(schedTask.status, 'waiting', '入队 300ms 后任务不应仍停留在等待中')
  await waitForIdle()
  assert.equal(schedTask.status, 'done', `调度测试任务失败: ${schedTask.error}`)

  // TC-10 重试期间状态保持 downloading，不回到 waiting
  await enqueueDownloads([{ ...musicBase, id: 'retry', name: 'RETRY_ONCE', singer: '周杰伦' }], { listName: '测试歌单' })
  let sawRetrying = false
  for (let i = 0; i < 80; i++) {
    const task = findTask('RETRY_ONCE')
    if (task.stage === 'retrying') {
      sawRetrying = true
      assert.equal(task.status, 'downloading', '重试等待期间状态应保持 downloading')
      break
    }
    await new Promise(resolve => setTimeout(resolve, 50))
  }
  assert.ok(sawRetrying, '未观察到重试阶段')
  await waitForIdle()
  const retryTask = findTask('RETRY_ONCE')
  assert.equal(retryTask.status, 'done', `重试后应成功: ${retryTask.error}`)

  // TC-11 暂停后入队新任务应自动恢复
  pauseAllDownloads()
  await enqueueDownloads([{ ...musicBase, id: 'resume', name: '暂停恢复测试', singer: '周杰伦' }], { listName: '测试歌单' })
  await waitForIdle()
  const resumeTask = findTask('暂停恢复测试')
  assert.equal(resumeTask.status, 'done', `暂停后新任务应自动恢复并完成: ${resumeTask.error}`)

  // TC-12 文件头识别不再依赖 Buffer（RN 下 quick-base64 版本不匹配会直接崩）
  const flacHead = base64ToBytes(Buffer.from('fLaC0000').toString('base64'), 8)
  assert.deepEqual(flacHead.slice(0, 4), [0x66, 0x4c, 0x61, 0x43], 'FLAC 头解析错误')
  const id3Head = base64ToBytes(Buffer.from('ID3\u0004\u0000\u0000').toString('base64'), 8)
  assert.equal(isMp3Header(id3Head), true, 'ID3 头应识别为 mp3')
  const frameHead = base64ToBytes(Buffer.from([0xff, 0xfb, 0x90, 0x00]).toString('base64'), 8)
  assert.equal(isMp3Header(frameHead), true, 'MPEG 帧同步头应识别为 mp3')
  assert.equal(isMp3Header(flacHead), false, 'FLAC 不应被识别为 mp3')
  assert.deepEqual(base64ToBytes('', 8), [], '空串应返回空数组')

  // TC-15 纯 JS base64 解析与 Buffer 对拍，确保替换后字节完全一致
  for (let i = 0; i < 300; i++) {
    const len = 1 + (i % 16)
    const bytes = Array.from({ length: len }, (_, k) => (i * 31 + k * 7) % 256)
    const b64 = Buffer.from(bytes).toString('base64')
    assert.deepEqual(base64ToBytes(b64, len), bytes, `base64 解析不一致: ${b64}`)
  }

  // TC-13 失败时错误信息要带上出错步骤，方便真机定位
  settingState.setting['download.maxRetry'] = 0
  await enqueueDownloads([{ ...musicBase, id: 'always-fail', name: 'ALWAYS_FAIL', singer: '周杰伦' }], { listName: '测试歌单' })
  await waitForIdle()
  const failTask = findTask('ALWAYS_FAIL')
  assert.equal(failTask.status, 'error', '音源持续报错时任务应失败')
  assert.ok(failTask.error.includes('[获取下载地址'), `错误信息应带步骤前缀: ${failTask.error}`)
  settingState.setting['download.maxRetry'] = 2

  // TC-14 目录逐级创建（mock 的 mkdir 是非递归的，父目录缺失时必须能自己补齐）
  assert.ok(fs.existsSync(listDir), '三级下载目录应被创建')
  assert.equal(fs.statSync(listDir).isDirectory(), true, '下载目录应是文件夹')

  // TC-16 歌词首下失败 → 「重下失败歌词」应补齐
  settingState.setting['download.isDownloadLyric'] = true
  settingState.setting['download.isDownloadTLyric'] = true
  settingState.setting['download.isDownloadRLyric'] = true
  await enqueueDownloads([{ ...musicBase, id: 'lyric-fail', name: 'LYRIC_FAIL_ONCE', singer: '周杰伦' }], { listName: '测试歌单' })
  await waitForIdle()
  const lyricFail = findTask('LYRIC_FAIL_ONCE')
  assert.equal(lyricFail.status, 'done', `歌词失败任务应完成音频下载: ${lyricFail.error}`)
  assert.equal(lyricFail.lyricState, 'fail', `首次歌词失败应记为 fail，实际 ${lyricFail.lyricState}`)
  assert.equal(fs.existsSync(getLyricPath(lyricFail.filePath)), false, '歌词失败时不应生成 .lrc')
  assert.ok(lyricFail.warning.includes('歌词'), `任务警告应包含歌词失败: ${lyricFail.warning}`)
  const missingCount = await countMissingLyrics()
  assert.ok(missingCount >= 1, `应统计到缺失歌词的任务，实际 ${missingCount}`)

  const retry1 = await retryFailedLyrics()
  assert.equal(retry1.disabled, false, '已开启歌词下载时不应返回 disabled')
  assert.ok(retry1.total >= 1, `重下应覆盖歌词失败的任务，实际 ${JSON.stringify(retry1)}`)
  assert.ok(retry1.ok >= 1, `重下应至少成功一首: ${JSON.stringify(retry1)}`)
  assert.ok(fs.existsSync(getLyricPath(lyricFail.filePath)), '重下后应生成 .lrc')
  assert.equal(lyricFail.lyricState, 'ok')
  assert.ok(fs.readFileSync(getLyricPath(lyricFail.filePath), 'utf8').includes('测试歌词'), '重下歌词内容应正确')
  assert.equal(lyricFail.warning.includes('歌词'), false, '重下成功后应清掉歌词失败提示')

  // TC-17 旧版本任务（无 lyricState）+ 手动删掉的歌词，也应一并补齐
  const sunny = findTask('晴天')
  const sunnyLrc = getLyricPath(sunny.filePath)
  fs.unlinkSync(sunnyLrc)
  delete sunny.lyricState
  const retry2 = await retryFailedLyrics()
  assert.ok(retry2.total >= 1, '旧任务缺歌词也应进入重下范围')
  assert.ok(fs.existsSync(sunnyLrc), '旧任务缺失的歌词应被补回')

  // TC-18 没有缺失时直接返回 0
  const retry3 = await retryFailedLyrics()
  assert.equal(retry3.total, 0, `全部有歌词时应返回 0，实际 ${JSON.stringify(retry3)}`)
  assert.equal(retry3.ok, 0)

  // TC-19 关闭歌词下载时直接返回 disabled，不写任何文件
  settingState.setting['download.isDownloadLyric'] = false
  fs.unlinkSync(sunnyLrc)
  const retry4 = await retryFailedLyrics()
  assert.equal(retry4.disabled, true, '关闭歌词下载时应返回 disabled')
  assert.equal(fs.existsSync(sunnyLrc), false, '关闭时不应写入歌词')
  settingState.setting['download.isDownloadLyric'] = true
  // 补回，保持汇总里的文件清单完整
  await retryFailedLyrics()
  assert.ok(fs.existsSync(sunnyLrc), '恢复开关后应能补回歌词')

  // TC-20 并发数设置：上下限收敛 + 运行期不突破上限
  settingState.setting['download.concurrent'] = 5
  assert.equal(getEngineStatus().concurrency, 5, '并发数 5 应生效')
  settingState.setting['download.concurrent'] = 99
  assert.equal(getEngineStatus().concurrency, 5, '并发数应封顶在 5')
  settingState.setting['download.concurrent'] = 1
  assert.equal(getEngineStatus().concurrency, 1, '并发数应能调到 1')

  settingState.setting['download.quality'] = '128k'
  const concurrentSongs = [
    { ...musicBase, id: 'conc-1', name: 'CONC_1', singer: '周杰伦' },
    { ...musicBase, id: 'conc-2', name: 'CONC_2', singer: '周杰伦' },
    { ...musicBase, id: 'conc-3', name: 'CONC_3', singer: '周杰伦' },
  ]
  await enqueueDownloads(concurrentSongs, { listName: '测试歌单' })
  let maxRunning = 0
  for (let i = 0; i < 200; i++) {
    const status = getEngineStatus()
    if (status.running > maxRunning) maxRunning = status.running
    assert.ok(status.running <= status.concurrency, `运行数 ${status.running} 不应超过并发上限 ${status.concurrency}`)
    assert.ok(status.activeIds.length <= status.concurrency, '在途任务数不应超过并发上限')
    const finished = concurrentSongs.every(song => {
      const task = getDownloadTasks().find(item => item.musicInfo.id === song.id)
      return task && (task.status === 'done' || task.status === 'error')
    })
    if (finished) break
    await new Promise(resolve => setTimeout(resolve, 200))
  }
  assert.ok(maxRunning <= 1, `并发设为 1 时不应有多个任务同时跑，实际峰值 ${maxRunning}`)
  assert.ok(maxRunning >= 1, '并发设为 1 时仍应有任务在跑')
  settingState.setting['download.concurrent'] = 3

  // TC-21 批量重试失败：一次把全部 error 任务放回队列
  settingState.setting['download.maxRetry'] = 0
  await enqueueDownloads([
    { ...musicBase, id: 'batch-fail-1', name: 'ALWAYS_FAIL', singer: '周杰伦' },
    { ...musicBase, id: 'batch-fail-2', name: 'ALWAYS_FAIL', singer: '周杰伦' },
  ], { listName: '测试歌单' })
  await waitForIdle()
  const failedBefore = getDownloadTasks().filter(task => task.status === 'error').length
  assert.ok(failedBefore >= 2, `应至少有两个失败任务，实际 ${failedBefore}`)
  const retried = retryAllFailed()
  assert.equal(retried, failedBefore, '批量重试应覆盖全部失败任务')
  assert.equal(
    getDownloadTasks().filter(task => task.status === 'error').length,
    0,
    '调用后失败任务应立即离开 error 状态',
  )
  await waitForIdle()
  const failedAfter = getDownloadTasks().filter(task => task.status === 'error').length
  assert.equal(failedAfter, failedBefore, '音源持续报错时重试后仍应回到 error')
  settingState.setting['download.maxRetry'] = 2
  removeDownloadTask('kw_batch-fail-1')
  removeDownloadTask('kw_batch-fail-2')

  // TC-22 空间预检：按音质估算所需空间，不足时给出提示但不阻断入队
  const defaultFree = process.env.TEST_FREE_SPACE
  process.env.TEST_FREE_SPACE = String(8 * 1024 * 1024)
  const spaceAdded = await enqueueDownloads([
    { ...musicBase, id: 'space', name: 'SPACE_TEST', singer: '周杰伦' },
  ], { listName: '测试歌单', quality: '320k' })
  assert.equal(spaceAdded, 1, '空间不足时仍应允许入队')
  const spaceInfo = getLastSpaceInfo()
  assert.ok(spaceInfo, '空间不足时应给出提示信息')
  assert.equal(spaceInfo!.need, 10 * 1024 * 1024, '320k 应按 10MB/首估算')
  await waitForIdle()
  process.env.TEST_FREE_SPACE = defaultFree
  await enqueueDownloads([
    { ...musicBase, id: 'space-ok', name: 'SPACE_OK', singer: '周杰伦' },
  ], { listName: '测试歌单', quality: '128k' })
  assert.equal(getLastSpaceInfo(), null, '空间充足时不应给出提示')
  await waitForIdle()

  // TC-23 仅 WiFi 下载：移动网络挂起，切回 WiFi 自动继续
  settingState.setting['download.isWifiOnly'] = true
  network.type = 'mobile'
  await enqueueDownloads([
    { ...musicBase, id: 'wifi', name: 'WIFI_ONLY', singer: '周杰伦' },
  ], { listName: '测试歌单', quality: '128k' })
  await new Promise(resolve => setTimeout(resolve, 2000))
  const wifiTask = getDownloadTasks().find(task => task.musicInfo.id === 'wifi')!
  assert.equal(wifiTask.status, 'waiting', `移动网络下任务应保持等待，实际 ${wifiTask.status}`)
  assert.equal(getEngineStatus().waitingForWifi, true, '引擎应标记为等待 WiFi')
  assert.equal(getEngineStatus().running, 0, '等待 WiFi 时不应有任务在跑')
  network.type = 'wifi'
  await waitForIdle(120000)
  assert.equal(wifiTask.status, 'done', `回到 WiFi 后应完成: ${wifiTask.error}`)
  settingState.setting['download.isWifiOnly'] = false

  // TC-24 增量更新：别的任务下载时，已完成任务的 rev 不应变化
  const sunnyTask = getDownloadTasks().find(task => task.musicInfo.name === '晴天')!
  const sunnyRev = sunnyTask.rev
  await enqueueDownloads([
    { ...musicBase, id: 'rev', name: 'REV_TEST', singer: '周杰伦' },
  ], { listName: '测试歌单', quality: '128k' })
  await waitForIdle()
  assert.equal(sunnyTask.rev, sunnyRev, '其他任务下载时，已完成任务的 rev 不应变化')
  const revTask = getDownloadTasks().find(task => task.musicInfo.id === 'rev')!
  assert.ok((revTask.rev ?? 0) > 0, '新任务的 rev 应被推进')

  // TC-25 日志落盘：能写、能读、目录结构正确
  await flushDownloadLogs()
  const logText = await readRecentLogs(200)
  assert.ok(logText.includes('[engine]'), '落盘日志应包含引擎条目')
  assert.ok(logText.includes('init:'), '落盘日志应包含启动记录')
  const logDir = path.join(root, '.private', 'download-logs')
  assert.ok(fs.existsSync(logDir), '日志目录应被创建')
  const logFiles = fs.readdirSync(logDir).filter(name => name.endsWith('.log'))
  assert.ok(logFiles.length >= 1, '应至少有一个日志文件')
  const logBytes = logFiles.reduce((sum, name) => sum + fs.statSync(path.join(logDir, name)).size, 0)
  assert.ok(logBytes > 0, '日志文件不应为空')

  // 汇总
  const summary = getDownloadTasks().map(task => ({
    name: task.musicInfo.name,
    status: task.status,
    quality: task.quality,
    ext: task.ext,
    file: task.filePath,
    size: task.total,
    warning: task.warning,
    error: task.error,
  }))
  const metadataCalls = calls.filter(call => call.type === 'metadata').length
  const lyricCalls = calls.filter(call => call.type === 'lyric').length
  const picCalls = calls.filter(call => call.type === 'pic').length
  const scanCalls = calls.filter(call => call.type === 'scan').length
  const files = fs.readdirSync(listDir).sort()

  clearCompletedDownloads()
  fs.writeFileSync('/tmp/lx-download-test-result.json', JSON.stringify({
    ok: true,
    summary,
    files,
    calls: { metadata: metadataCalls, lyric: lyricCalls, pic: picCalls, scan: scanCalls },
    mergedLyricLines: merged.split('\n').length,
  }, null, 2))
  console.log('TEST_OK', JSON.stringify({ summary, files, calls: { metadataCalls, lyricCalls, picCalls, scanCalls } }, null, 2))
  process.exit(0)
}

main().catch(err => {
  console.error('TEST_FAILED', err)
  fs.writeFileSync('/tmp/lx-download-test-result.json', JSON.stringify({ ok: false, error: String(err?.stack ?? err) }, null, 2))
  process.exit(1)
})
