import fs from 'node:fs'

export default {
  ExternalDirectoryPath: process.env.TEST_DOWNLOAD_DIR!,
  read: async(filePath: string, length: number, position: number) => {
    const fd = fs.openSync(filePath, 'r')
    const buf = Buffer.alloc(length)
    const read = fs.readSync(fd, buf, 0, length, position)
    fs.closeSync(fd)
    return buf.subarray(0, read).toString('base64')
  },
}
