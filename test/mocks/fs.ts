import fs from 'node:fs'
import path from 'node:path'

export const externalStorageDirectoryPath = process.env.TEST_DOWNLOAD_DIR!
export const temporaryDirectoryPath = path.join(externalStorageDirectoryPath, '.tmp')
export const privateStorageDirectoryPath = path.join(externalStorageDirectoryPath, '.private')

export const getFSInfo = async() => ({
  totalSpace: Number(process.env.TEST_TOTAL_SPACE ?? 64 * 1024 * 1024 * 1024),
  freeSpace: Number(process.env.TEST_FREE_SPACE ?? 32 * 1024 * 1024 * 1024),
})

export const existsFile = async(p: string) => fs.existsSync(p)

export const appendFile = async(p: string, data: string) => {
  fs.appendFileSync(p, data, 'utf8')
}

export const readFile = async(p: string) => fs.readFileSync(p, 'utf8')

export const readDir = async(p: string) => fs.readdirSync(p).map(name => {
  const full = path.join(p, name)
  const info = fs.statSync(full)
  return {
    name,
    path: full,
    isFile: info.isFile(),
    isDirectory: info.isDirectory(),
    size: info.size,
    lastModified: info.mtimeMs,
  } as any
})

export const mkdir = async(p: string) => {
  // 刻意用非递归版本，复刻 react-native-file-system 原生的行为：
  // 父目录不存在时会直接失败，用来验证下载引擎会逐级建目录
  fs.mkdirSync(p)
  return { path: p } as any
}

export const moveFile = async(from: string, to: string) => {
  fs.renameSync(from, to)
  return true
}

export const unlink = async(p: string) => {
  try {
    fs.unlinkSync(p)
    return true
  } catch {
    return false
  }
}

export const stat = async(p: string) => ({ size: fs.statSync(p).size } as any)

export const writeFile = async(p: string, data: string) => {
  fs.writeFileSync(p, data, 'utf8')
}

export const downloadFile = (url: string, dst: string, options: any = {}) => {
  const jobId = Math.floor(Math.random() * 1e6)
  const promise = (async() => {
    const res = await fetch(url)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const total = Number(res.headers.get('content-length') ?? 0)
    const chunks: Uint8Array[] = []
    let written = 0
    if (res.body) {
      for await (const chunk of res.body as any) {
        const buf = Buffer.from(chunk)
        chunks.push(buf)
        written += buf.length
        options.progress?.({ bytesWritten: written, contentLength: total })
      }
    }
    fs.writeFileSync(dst, Buffer.concat(chunks))
    return { jobId, statusCode: res.status, bytesWritten: written }
  })()
  return { jobId, promise }
}

export const stopDownload = () => {}
