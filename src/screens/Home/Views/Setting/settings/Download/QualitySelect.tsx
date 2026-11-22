import { memo, useMemo } from 'react'
import { StyleSheet, View } from 'react-native'

import SubTitle from '../../components/SubTitle'
import CheckBox from '@/components/common/CheckBox'
import Text from '@/components/common/Text'
import { useTheme } from '@/store/theme/hook'
import { useSettingValue } from '@/store/setting/hook'
import { updateSetting } from '@/core/common'
import { useI18n } from '@/lang'

const QUALITYS = ['128k', '320k', 'flac', 'flac24bit', 'auto'] as const

const Item = ({ id }: { id: typeof QUALITYS[number] }) => {
  const t = useI18n()
  const quality = useSettingValue('download.quality')
  const isActive = useMemo(() => quality === id, [quality, id])
  return (
    <CheckBox
      marginRight={10}
      marginBottom={4}
      check={isActive}
      label={t(`setting_download_quality_${id}`)}
      onChange={() => { updateSetting({ 'download.quality': id }) }}
      need
    />
  )
}

export default memo(() => {
  const t = useI18n()
  const theme = useTheme()

  return (
    <SubTitle title={t('setting_download_quality')}>
      <View style={styles.list}>
        {QUALITYS.map(item => <Item key={item} id={item} />)}
      </View>
      <Text size={12} color={theme['c-font-label']} style={styles.tip}>{t('setting_download_quality_tip')}</Text>
    </SubTitle>
  )
})

const styles = StyleSheet.create({
  list: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  tip: {
    marginTop: 6,
    paddingRight: 15,
  },
})
