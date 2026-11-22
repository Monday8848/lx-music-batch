import { memo, useCallback, useEffect, useState } from 'react'
import { View } from 'react-native'

import CheckBoxItem from '../../components/CheckBoxItem'
import SubTitle from '../../components/SubTitle'
import Button from '@/components/common/Button'
import Text from '@/components/common/Text'
import { useSettingValue } from '@/store/setting/hook'
import { updateSetting } from '@/core/common'
import { useI18n } from '@/lang'
import { useTheme } from '@/store/theme/hook'
import { clipboardWriteText, confirmDialog, createStyle, toast } from '@/utils/tools'
import {
  clearDownloadLogs,
  getDownloadLogSize,
  readRecentLogs,
  setDownloadLogEnabled,
} from '@/core/download'
import { BorderRadius } from '@/theme'

const formatSize = (bytes: number) => {
  if (!bytes) return '0 KB'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`
}

export default memo(() => {
  const t = useI18n()
  const theme = useTheme()
  const enabled = useSettingValue('download.isSaveLog')
  const [size, setSize] = useState(0)
  const [busy, setBusy] = useState(false)

  const refresh = useCallback(() => {
    void getDownloadLogSize().then(setSize).catch(() => {})
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  const handleToggle = (check: boolean) => {
    updateSetting({ 'download.isSaveLog': check })
    setDownloadLogEnabled(check)
  }

  const handleExport = async() => {
    if (busy) return
    setBusy(true)
    try {
      const text = await readRecentLogs(400)
      if (!text) {
        toast(t('setting_download_log_empty'))
        return
      }
      clipboardWriteText(text)
      toast(t('setting_download_log_copied'))
    } catch (err: any) {
      toast(String(err?.message ?? err))
    } finally {
      setBusy(false)
      refresh()
    }
  }

  const handleClear = async() => {
    if (!await confirmDialog({ message: t('setting_download_log_clear_confirm') })) return
    await clearDownloadLogs()
    refresh()
    toast(t('setting_download_log_cleared'))
  }

  return (
    <SubTitle title={t('setting_download_log_group')}>
      <CheckBoxItem
        check={enabled}
        label={t('setting_download_log')}
        onChange={handleToggle}
      />
      {enabled
        ? <View style={styles.actions}>
            <Text size={12} color={theme['c-font-label']} style={styles.size}>
              {t('setting_download_log_size', { size: formatSize(size) })}
            </Text>
            <Button style={{ ...styles.btn, backgroundColor: theme['c-button-background'] }} onPress={handleExport} disabled={busy}>
              <Text size={12} color={theme['c-button-font']}>{t('setting_download_log_export')}</Text>
            </Button>
            <Button style={{ ...styles.btn, backgroundColor: theme['c-button-background'] }} onPress={handleClear}>
              <Text size={12} color={theme['c-button-font']}>{t('setting_download_log_clear')}</Text>
            </Button>
          </View>
        : null}
      <Text size={12} color={theme['c-font-label']} style={styles.tip}>{t('setting_download_log_tip')}</Text>
    </SubTitle>
  )
})

const styles = createStyle({
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    paddingLeft: 25,
    paddingRight: 15,
    marginTop: 2,
    marginBottom: 2,
  },
  size: {
    marginRight: 12,
  },
  btn: {
    paddingLeft: 12,
    paddingRight: 12,
    paddingTop: 6,
    paddingBottom: 6,
    borderRadius: BorderRadius.normal,
    marginRight: 8,
  },
  tip: {
    marginTop: 6,
    paddingLeft: 25,
    paddingRight: 15,
  },
})
