import { memo } from 'react'
import { StyleSheet, View } from 'react-native'

import CheckBoxItem from '../../components/CheckBoxItem'
import SubTitle from '../../components/SubTitle'
import Text from '@/components/common/Text'
import { useSettingValue } from '@/store/setting/hook'
import { updateSetting } from '@/core/common'
import { useI18n } from '@/lang'
import { useTheme } from '@/store/theme/hook'

export default memo(() => {
  const t = useI18n()
  const theme = useTheme()
  const pic = useSettingValue('download.isDownloadPic')
  const metadata = useSettingValue('download.isWriteMetadata')
  const extra = useSettingValue('download.isWriteExtraMetadata')

  return (
    <SubTitle title={t('setting_download_meta_group')}>
      <CheckBoxItem
        check={pic}
        label={t('setting_download_pic')}
        onChange={check => { updateSetting({ 'download.isDownloadPic': check }) }}
      />
      <CheckBoxItem
        check={metadata}
        label={t('setting_download_metadata')}
        onChange={check => { updateSetting({ 'download.isWriteMetadata': check }) }}
      />
      <View style={styles.sub}>
        <CheckBoxItem
          check={extra}
          label={t('setting_download_extra_metadata')}
          onChange={check => { updateSetting({ 'download.isWriteExtraMetadata': check }) }}
          disabled={!metadata}
        />
      </View>
      <Text size={12} color={theme['c-font-label']} style={styles.tip}>{t('setting_download_meta_tip')}</Text>
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
