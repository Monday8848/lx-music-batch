import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'

const lyricFailOnce = new Set<string>()

export const getLyricInfo = async({ musicInfo }: any = {}) => {
  const name = String(musicInfo?.name ?? '')
  // 第一次报错、第二次成功：用来验证「重下失败歌词」
  if (name.includes('LYRIC_FAIL_ONCE') && !lyricFailOnce.has(name)) {
    lyricFailOnce.add(name)
    throw new Error('模拟：歌词接口临时失败')
  }
  return {
    lyric: '[00:00.00]测试歌词\n[00:01.00]用于验证下载器的歌词写入',
    tlyric: '[00:00.00]测试翻译\n[00:01.00]用于验证翻译合并',
    rlyric: '[00:00.00]tesutokashi\n[00:01.00]yourou',
    lxlyric: null,
  }
}

const jpeg = Buffer.from('/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==', 'base64')

let server: http.Server | null = null
let url = ''

const ensureServer = async() => {
  if (url) return url
  server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Content-Length': jpeg.length })
    res.end(jpeg)
  })
  await new Promise<void>(resolve => server!.listen(0, '127.0.0.1', resolve))
  const port = (server!.address() as any).port
  url = `http://127.0.0.1:${port}/cover.jpg`
  return url
}

export const getPicPath = async() => ensureServer()

// 保留一个临时文件，用于观察下载目录
export const writeTempCover = () => {
  const picPath = path.join(process.env.TEST_DOWNLOAD_DIR!, '.tmp', 'cover.jpg')
  fs.mkdirSync(path.dirname(picPath), { recursive: true })
  fs.writeFileSync(picPath, jpeg)
  return picPath
}
