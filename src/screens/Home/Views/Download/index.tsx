import { memo, useCallback, useMemo, useState } from 'react'
import { FlatList, TouchableOpacity, View } from 'react-native'

import Text from '@/components/common/Text'
import Button from '@/components/common/Button'
import { Icon } from '@/components/common/Icon'
import { useTheme } from '@/store/theme/hook'
import { useDownloadTasks } from '@/store/download/hook'
import {
  clearCompletedDownloads,
  getDownloadLogs,
  getDownloadStats,
  getDownloadTasks,
  getEngineStatus,
  getLyricRetryStatus,
  pauseAllDownloads,
  readRecentLogs,
  removeDownloadTask,
  resumeAllDownloads,
  retryAllFailed,
  retryDownload,
  retryFailedLyrics,
  type DownloadTask,
} from '@/core/download'
import { useI18n } from '@/lang'
import { clipboardWriteText, createStyle, toast } from '@/utils/tools'
import { BorderWidths, BorderRadius } from '@/theme'

const formatSize = (bytes: number) => {
  if (!bytes || bytes < 0) return '0 MB'
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

const formatSpeed = (bytes: number) => {
  if (!bytes || bytes < 0) return ''
  if (bytes < 1024) return `${Math.round(bytes)} B/s`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB/s`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB/s`
}

const formatQuality = (quality: string, ext: string) => {
  switch (quality) {
    case 'flac24bit': return 'FLAC 24bit'
    case 'flac': return 'FLAC'
    case '320k': return '320k MP3'
    case '128k': return '128k MP3'
    default: return ext ? ext.toUpperCase() : quality
  }
}

const TaskItem = memo(({ task, onRetry, onRemove }: {
  task: DownloadTask
  onRetry: (id: string) => void
  onRemove: (id: string) => void
}) => {
  const t = useI18n()
  const theme = useTheme()

  const statusText = useMemo(() => {
    switch (task.status) {
      case 'downloading':
        if (task.stage === 'preparing') return t('download_stage_preparing')
        if (task.stage === 'tagging') return t('download_stage_tagging')
        if (task.stage === 'retrying') return t('download_stage_retrying', { n: task.retry })
        return `${Math.round(task.progress * 100)}%`
      case 'waiting':
        return t('download_status_waiting')
      case 'paused':
        return t('download_status_paused')
      case 'done':
        return t('download_status_done')
      case 'error':
        return t('download_status_error')
    }
  }, [task.status, task.progress, task.stage, task.retry, t])

  const progress = task.status === 'done' ? 1 : Math.max(0, Math.min(1, task.progress))
  const statusColor = task.status === 'error'
    ? '#e5484d'
    : task.status === 'done'
      ? theme['c-primary']
      : theme['c-font-label']

  return (
    <View style={{ ...styles.item, borderBottomColor: theme['c-border-background'] }}>
      <View style={styles.itemContent}>
        <View style={styles.itemTitleRow}>
          <Text size={15} numberOfLines={1} style={styles.itemName}>{task.musicInfo.name}</Text>
          <Text size={12} color={statusColor} style={styles.itemStatus}>{statusText}</Text>
        </View>
        <Text size={12} color={theme['c-font-label']} numberOfLines={1}>
          {task.musicInfo.singer}
          {task.quality ? ` · ${formatQuality(task.quality, task.ext)}` : ''}
          {task.total > 0 ? ` · ${formatSize(task.total)}` : ''}
          {task.status === 'downloading' && task.speed > 0 ? ` · ${formatSpeed(task.speed)}` : ''}
        </Text>
        <View style={{ ...styles.progressTrack, backgroundColor: theme['c-border-background'] }}>
          <View style={{ ...styles.progressBar, width: `${progress * 100}%`, backgroundColor: task.status === 'error' ? '#e5484d' : theme['c-primary'] }} />
        </View>
        {task.error ? <Text size={11} color={'#e5484d'} numberOfLines={3} style={styles.tip}>{task.error}</Text> : null}
        {!task.error && task.warning ? <Text size={11} color={theme['c-font-label']} numberOfLines={2} style={styles.tip}>{task.warning}</Text> : null}
        {task.status === 'done' && task.filePath ? <Text size={11} color={theme['c-font-label']} numberOfLines={1} style={styles.tip}>{task.filePath}</Text> : null}
      </View>
      <View style={styles.actions}>
        {task.status === 'error'
          ? <TouchableOpacity onPress={() => { onRetry(task.id) }} style={styles.iconBtn}>
              <Icon name="refresh" size={18} color={theme['c-primary']} />
            </TouchableOpacity>
          : null}
        {task.status === 'done' || task.status === 'error'
          ? <TouchableOpacity onPress={() => { onRemove(task.id) }} style={styles.iconBtn}>
              <Icon name="close" size={16} color={theme['c-font-label']} />
            </TouchableOpacity>
          : null}
      </View>
    </View>
  )
})

export default memo(() => {
  const t = useI18n()
  const theme = useTheme()
  const tasks = useDownloadTasks()
  const stats = getDownloadStats()
  const engine = getEngineStatus()

  const handleRetry = useCallback((id: string) => { retryDownload(id) }, [])
  const handleRemove = useCallback((id: string) => { removeDownloadTask(id) }, [])

  const lyricRetry = getLyricRetryStatus()
  const [lyricBusy, setLyricBusy] = useState(false)
  const handleRetryLyrics = useCallback(async() => {
    if (lyricBusy) return
    setLyricBusy(true)
    try {
      const result = await retryFailedLyrics()
      if (result.disabled) {
        toast(t('download_retry_lyric_disabled'))
      } else if (!result.total) {
        toast(t('download_retry_lyric_none'))
      } else if (result.fail) {
        toast(t('download_retry_lyric_partial', { ok: result.ok, fail: result.fail }))
      } else {
        toast(t('download_retry_lyric_done', { ok: result.ok }))
      }
    } catch (err: any) {
      toast(String(err?.message ?? err))
    } finally {
      setLyricBusy(false)
    }
  }, [lyricBusy, t])

  const handleDiagnostics = useCallback(async() => {
    const status = getEngineStatus()
    const sum = getDownloadStats()
    // 内存日志为空（通常是刚重启）时退回磁盘日志，仍然能给出上一次运行的现场
    let tail = getDownloadLogs()
    if (!tail.length) {
      try {
        tail = (await readRecentLogs(120)).split('\n').filter(Boolean)
      } catch {}
    }
    const lines = [
      'LX Music 下载诊断',
      `time: ${new Date().toISOString()}`,
      `engine: inited=${status.inited} paused=${status.paused} running=${status.running}/${status.concurrency} network=${status.network} waitingWifi=${status.waitingForWifi} active=${status.activeIds.join(',') || '-'}`,
      `queue: total=${sum.total} waiting=${sum.waiting} downloading=${sum.downloading} done=${sum.done} error=${sum.error}`,
      '--- tasks ---',
      ...getDownloadTasks().slice(0, 40).map(task => (
        `[${task.status}] ${task.musicInfo.name} - ${task.musicInfo.singer} | q=${task.requestedQuality}->${task.quality} | stage=${task.stage || '-'} | retry=${task.retry} | ${task.progress ? Math.round(task.progress * 100) : 0}% | ${task.error || '-'}`
      )),
      '--- logs ---',
      ...tail,
    ]
    clipboardWriteText(lines.join('\n'))
    toast(t('download_diagnostic_copied'))
  }, [t])

  const renderItem = useCallback(({ item }: { item: DownloadTask }) => (
    <TaskItem task={item} onRetry={handleRetry} onRemove={handleRemove} />
  ), [handleRetry, handleRemove])

  return (
    <View style={styles.container}>
      <View style={{ ...styles.header, borderBottomColor: theme['c-border-background'] }}>
        <View style={styles.headerTitleRow}>
          <Text size={18}>{t('download_page_title')}</Text>
          <Text size={12} color={theme['c-font-label']}>{t('download_task_summary', { done: stats.done, total: stats.total })}</Text>
        </View>
        <Text size={11} color={engine.paused ? '#e5484d' : engine.waitingForWifi ? '#f5a623' : theme['c-font-label']} numberOfLines={1} style={styles.engineLine}>
          {engine.waitingForWifi
            ? t('download_engine_waiting_wifi', { waiting: stats.waiting })
            : engine.paused
              ? t('download_engine_paused', { waiting: stats.waiting })
              : t('download_engine_status', { running: engine.running, concurrency: engine.concurrency, waiting: stats.waiting, error: stats.error })}
        </Text>
        <View style={styles.headerBtns}>
          <Button
            style={{ ...styles.headerBtn, backgroundColor: theme['c-button-background'] }}
            onPress={() => { engine.paused ? resumeAllDownloads() : pauseAllDownloads() }}
            disabled={!stats.total}
          >
            <Text size={12} color={theme['c-button-font']}>{engine.paused ? t('download_resume_all') : t('download_pause_all')}</Text>
          </Button>
          <Button
            style={{ ...styles.headerBtn, backgroundColor: theme['c-button-background'] }}
            onPress={() => { clearCompletedDownloads() }}
            disabled={!stats.done}
          >
            <Text size={12} color={theme['c-button-font']}>{t('download_clear_done')}</Text>
          </Button>
          <Button
            style={{ ...styles.headerBtn, backgroundColor: theme['c-button-background'] }}
            onPress={() => {
              const count = retryAllFailed()
              toast(count ? t('download_retry_failed_started', { n: count }) : t('download_retry_failed_none'))
            }}
            disabled={!stats.error}
          >
            <Text size={12} color={theme['c-button-font']}>{t('download_retry_failed')}</Text>
          </Button>
          <Button
            style={{ ...styles.headerBtn, backgroundColor: theme['c-button-background'] }}
            onPress={handleRetryLyrics}
            disabled={!stats.done || lyricRetry.running || lyricBusy}
          >
            <Text size={12} color={theme['c-button-font']}>
              {lyricRetry.running
                ? t('download_retry_lyric_running', { done: lyricRetry.done, total: lyricRetry.total })
                : t('download_retry_lyric')}
            </Text>
          </Button>
          <Button
            style={{ ...styles.headerBtn, backgroundColor: theme['c-button-background'] }}
            onPress={handleDiagnostics}
            disabled={!stats.total}
          >
            <Text size={12} color={theme['c-button-font']}>{t('download_diagnostic')}</Text>
          </Button>
        </View>
      </View>
      {
        tasks.length
          ? <FlatList
              data={tasks}
              keyExtractor={item => item.id}
              renderItem={renderItem}
              style={styles.list}
              contentContainerStyle={styles.listContent}
              windowSize={7}
              maxToRenderPerBatch={8}
              updateCellsBatchingPeriod={50}
              initialNumToRender={12}
            />
          : <View style={styles.empty}>
              <Icon name="download-2" size={42} color={theme['c-350']} />
              <Text size={15} color={theme['c-font-label']} style={styles.emptyTitle}>{t('download_empty')}</Text>
              <Text size={12} color={theme['c-font-label']} style={styles.emptyTip}>{t('download_empty_tip')}</Text>
            </View>
      }
    </View>
  )
})

const styles = createStyle({
  container: {
    flex: 1,
  },
  header: {
    paddingLeft: 15,
    paddingRight: 15,
    paddingTop: 12,
    paddingBottom: 10,
    borderBottomWidth: BorderWidths.normal,
    flexGrow: 0,
    flexShrink: 0,
  },
  headerTitleRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  engineLine: {
    marginBottom: 8,
  },
  headerBtns: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  headerBtn: {
    paddingLeft: 12,
    paddingRight: 12,
    paddingTop: 7,
    paddingBottom: 7,
    borderRadius: BorderRadius.normal,
    marginRight: 8,
    marginBottom: 6,
  },
  list: {
    flex: 1,
  },
  listContent: {
    paddingBottom: 80,
  },
  item: {
    flexDirection: 'row',
    paddingLeft: 15,
    paddingRight: 8,
    paddingTop: 12,
    paddingBottom: 12,
    borderBottomWidth: BorderWidths.normal,
  },
  itemContent: {
    flex: 1,
    flexShrink: 1,
  },
  itemTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  itemName: {
    flex: 1,
    flexShrink: 1,
    paddingRight: 8,
  },
  itemStatus: {
    flexGrow: 0,
    flexShrink: 0,
  },
  progressTrack: {
    height: 3,
    borderRadius: 2,
    marginTop: 8,
    marginBottom: 2,
    overflow: 'hidden',
  },
  progressBar: {
    height: 3,
    borderRadius: 2,
  },
  tip: {
    marginTop: 5,
  },
  actions: {
    width: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconBtn: {
    padding: 8,
  },
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingBottom: 80,
    paddingLeft: 30,
    paddingRight: 30,
  },
  emptyTitle: {
    marginTop: 15,
  },
  emptyTip: {
    marginTop: 8,
    textAlign: 'center',
    lineHeight: 18,
  },
})
