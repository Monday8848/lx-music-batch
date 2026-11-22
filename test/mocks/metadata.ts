export const calls: Array<{ type: string, filePath: string, payload?: any }> = []

export const writeMetadata = async(filePath: string, metadata: any) => {
  calls.push({ type: 'metadata', filePath, payload: metadata })
}

export const writePic = async(filePath: string, picPath: string) => {
  calls.push({ type: 'pic', filePath, payload: picPath })
}

export const writeLyric = async(filePath: string, lyric: string) => {
  calls.push({ type: 'lyric', filePath, payload: lyric })
}

export const scanFile = async(filePath: string) => {
  calls.push({ type: 'scan', filePath })
  return ''
}
