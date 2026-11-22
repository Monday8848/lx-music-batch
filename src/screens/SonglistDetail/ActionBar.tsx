import { memo, useState } from 'react'
import { View } from 'react-native'
import Button from '@/components/common/Button'

import { createStyle, requestStoragePermission, toast } from '@/utils/tools'
import { pop } from '@/navigation'
import { useTheme } from '@/store/theme/hook'
import commonState from '@/store/common/state'
import Text from '@/components/common/Text'
import { handleCollect, handlePlay } from './listAction'
import songlistState from '@/store/songlist/state'
import { useI18n } from '@/lang'
import { useListInfo } from './state'
import { getListDetailAll } from '@/core/songlist'
import { enqueueDownloads, getLastSpaceInfo } from '@/core/download'
// import { NAV_SHEAR_NATIVE_IDS } from '@/config/constant'

export default memo(() => {
  const theme = useTheme()
  const t = useI18n()
  const info = useListInfo()
  const [isDownloading, setIsDownloading] = useState(false)

  const back = () => {
    void pop(commonState.componentIds.songlistDetail!)
  }

  const handlePlayAll = () => {
    if (!songlistState.listDetailInfo.info.name) return
    void handlePlay(info.id, info.source, songlistState.listDetailInfo.list)
  }

  const handleDownloadAll = async() => {
    if (isDownloading) return
    setIsDownloading(true)
    try {
      const granted = await requestStoragePermission()
      if (granted !== true) {
        toast(t('download_permission_denied'), 'long')
        return
      }
      const list = await getListDetailAll(info.source, info.id)
      if (!list.length) {
        toast(t('download_no_tasks'), 'short')
        return
      }
      const num = await enqueueDownloads(list, {
        listId: info.id,
        listName: songlistState.listDetailInfo.info.name ?? info.name ?? '歌单',
      })
      const space = getLastSpaceInfo()
      if (space) {
        toast(t('download_low_space', {
          need: Math.round(space.need / 1048576),
          free: Math.round(space.free / 1048576),
        }), 'long')
      } else {
        toast(t('download_added', { num }), 'short')
      }
    } catch (err: any) {
      toast(String(err?.message ?? err), 'long')
    } finally {
      setIsDownloading(false)
    }
  }

  const handleCollection = () => {
    if (!songlistState.listDetailInfo.info.name) return
    void handleCollect(info.id, info.source, songlistState.listDetailInfo.info.name || info.name)
  }

  return (
    <View style={styles.container}>
      <Button onPress={handleCollection} style={styles.controlBtn}>
        <Text style={{ ...styles.controlBtnText, color: theme['c-button-font'] }}>{t('collect_songlist')}</Text>
      </Button>
      <Button onPress={handlePlayAll} style={styles.controlBtn}>
        <Text style={{ ...styles.controlBtnText, color: theme['c-button-font'] }}>{t('play_all')}</Text>
      </Button>
      <Button onPress={() => { void handleDownloadAll() }} style={styles.controlBtn} disabled={isDownloading}>
        <Text style={{ ...styles.controlBtnText, color: theme['c-button-font'] }}>{isDownloading ? t('download_status_downloading') : t('download_all')}</Text>
      </Button>
      <Button onPress={back} style={styles.controlBtn}>
        <Text style={{ ...styles.controlBtnText, color: theme['c-button-font'] }}>{t('back')}</Text>
      </Button>
    </View>
  )
})

const styles = createStyle({
  container: {
    flexDirection: 'row',
    width: '100%',
    flexGrow: 0,
    flexShrink: 0,
  },
  controlBtn: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: 0,
    paddingTop: 12,
    paddingBottom: 12,
    paddingLeft: 10,
    paddingRight: 10,
  },
  controlBtnText: {
    fontSize: 13,
    textAlign: 'center',
  },
})

