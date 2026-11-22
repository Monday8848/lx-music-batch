import { useEffect, useState } from 'react'

import { getDownloadTasks, subscribeDownload, type DownloadTask } from '@/core/download'

/**
 * 任务对象在引擎内部是原地修改的，引用始终不变，所以不能直接把它交给 React。
 *
 * 这里按 task.rev 做增量快照：
 * - rev 变了 → 复制一份新对象，列表项会重渲染
 * - rev 没变 → 复用上一次的对象，memo 直接跳过
 *
 * 效果是在 500 首任务的队列里，一次进度回调只会让 1~3 个列表项重绘，
 * 而不是整片列表跟着刷新。
 */
const cache = new Map<string, DownloadTask>()
const revCache = new Map<string, number>()

const snapshot = (): DownloadTask[] => {
  const source = getDownloadTasks()
  const next: DownloadTask[] = new Array(source.length)
  const alive = new Set<string>()

  for (let i = 0; i < source.length; i++) {
    const task = source[i]
    alive.add(task.id)
    const rev = task.rev ?? 0
    const cached = cache.get(task.id)
    if (cached && revCache.get(task.id) === rev) {
      next[i] = cached
      continue
    }
    const copy = { ...task }
    cache.set(task.id, copy)
    revCache.set(task.id, rev)
    next[i] = copy
  }

  if (cache.size !== alive.size) {
    for (const id of cache.keys()) {
      if (alive.has(id)) continue
      cache.delete(id)
      revCache.delete(id)
    }
  }

  return next
}

export const useDownloadTasks = (): DownloadTask[] => {
  const [tasks, setTasks] = useState<DownloadTask[]>(snapshot)

  useEffect(() => {
    const update = () => {
      setTasks(snapshot())
    }
    update()
    return subscribeDownload(update)
  }, [])

  return tasks
}
