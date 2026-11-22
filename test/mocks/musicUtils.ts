const API = 'https://source.shiqianjiang.cn/api/music/url'
const KEY = process.env.LX_SOURCE_KEY!

const fetchUrl = async(source: string, songId: string, quality: string) => {
  const url = new URL(API)
  url.searchParams.set('source', source)
  url.searchParams.set('songId', songId)
  url.searchParams.set('quality', quality)
  const res = await fetch(url, {
    headers: {
      'X-API-Key': KEY,
      'User-Agent': 'lx-music-mobile/1.9.2',
    },
  })
  if (!res.ok) throw new Error(`source HTTP ${res.status}`)
  const body = await res.json() as any
  if (body.code !== 200 || !body.url) throw new Error(body.message ?? '音源未返回地址')
  return body.url as string
}

// 模拟「整任务首次失败」：320k 与 128k 各失败一次，触发引擎重试
let retryOnceAttempts = 0
export const resetRetryOnce = () => { retryOnceAttempts = 0 }

export const handleGetOnlineMusicUrl = async({ musicInfo, quality }: any) => {
  const source = musicInfo.source as string
  const songId = String(musicInfo.meta?.songId ?? musicInfo.id)

  if (musicInfo.name === 'RETRY_ONCE') {
    retryOnceAttempts++
    if (retryOnceAttempts <= 2) throw new Error('模拟：首次获取地址失败')
  }

  if (musicInfo.name === 'ALWAYS_FAIL') {
    throw new Error('模拟：音源直接报错')
  }

  if (musicInfo.name === 'NO_320' && quality === '320k') {
    throw new Error('模拟：该曲目没有 320k')
  }

  if (musicInfo.name === 'FLAC_FALLBACK' && quality === '320k') {
    const url = await fetchUrl(source, songId, 'flac')
    return { url, quality: 'flac', musicInfo, isFromCache: false }
  }

  const url = await fetchUrl(source, songId, quality)
  return { url, quality, musicInfo, isFromCache: false }
}
