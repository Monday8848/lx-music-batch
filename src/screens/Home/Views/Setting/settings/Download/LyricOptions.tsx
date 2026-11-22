import { memo } from 'react'
import { StyleSheet, View } from 'react-native'

import CheckBoxItem from '../../components/CheckBoxItem'
import SubTitle from '../../components/SubTitle'
import Text from '@/components/common/Text'
import { useSettingValue } from '@/store/setting/hook'
import { updateSetting } from '@/core/common'
import { useI18n } from '@/lang'
import { useTheme } from '@/store/theme/hook'

const SubItem = ({ check, label, onChange, disabled }: {
  check: boolean
  label: string
  onChange: (check: boolean) => void
  disabled: boolean
}) => (
  <View style={styles.sub}>
    <CheckBoxItem check={check} label={label} onChange={onChange} disabled={disabled} />
  </View>
)

export default memo(() => {
  const t = useI18n()
  const theme = useTheme()
  const enabled = useSettingValue('download.isDownloadLyric')
  const tlyric = useSettingValue('download.isDownloadTLyric')
  const rlyric = useSettingValue('download.isDownloadRLyric')
  const embed = useSettingValue('download.isEmbedLyric')

  return (
    <SubTitle title={t('setting_download_lyric_group')}>
      <CheckBoxItem
        check={enabled}
        label={t('setting_download_lyric')}
        onChange={check => { updateSetting({ 'download.isDownloadLyric': check }) }}
      />
      <SubItem
        check={tlyric}
        disabled={!enabled}
        label={t('setting_download_tlyric')}
        onChange={check => { updateSetting({ 'download.isDownloadTLyric': check }) }}
      />
      <SubItem
        check={rlyric}
        disabled={!enabled}
        label={t('setting_download_rlyric')}
        onChange={check => { updateSetting({ 'download.isDownloadRLyric': check }) }}
      />
      <SubItem
        check={embed}
        disabled={!enabled}
        label={t('setting_download_embed_lyric')}
        onChange={check => { updateSetting({ 'download.isEmbedLyric': check }) }}
      />
      <Text size={12} color={theme['c-font-label']} style={styles.tip}>{t('setting_download_lyric_tip')}</Text>
    </SubTitle>
  )
})

const styles = StyleSheet.create({
  sub: {
    paddingLeft: 20,
  },
  tip: {
    marginTop: 6,
    paddingLeft: 25,
    paddingRight: 15,
  },
})
