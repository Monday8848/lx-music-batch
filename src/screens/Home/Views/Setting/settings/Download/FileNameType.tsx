import { memo, useMemo } from 'react'
import { StyleSheet, View } from 'react-native'

import SubTitle from '../../components/SubTitle'
import CheckBox from '@/components/common/CheckBox'
import Text from '@/components/common/Text'
import InputItem from '../../components/InputItem'
import { useTheme } from '@/store/theme/hook'
import { useSettingValue } from '@/store/setting/hook'
import { updateSetting } from '@/core/common'
import { useI18n } from '@/lang'

const TYPES = ['歌手 - 歌名', '歌名 - 歌手', '歌名', '自定义'] as const

const Item = ({ id }: { id: typeof TYPES[number] }) => {
  const t = useI18n()
  const type = useSettingValue('download.fileName')
  const isActive = useMemo(() => type === id, [type, id])
  return (
    <CheckBox
      marginRight={10}
      marginBottom={4}
      check={isActive}
      label={id === '自定义' ? t('setting_download_file_name_custom') : id}
      onChange={() => { updateSetting({ 'download.fileName': id }) }}
      need
    />
  )
}

export default memo(() => {
  const t = useI18n()
  const theme = useTheme()
  const type = useSettingValue('download.fileName')
  const template = useSettingValue('download.fileNameTemplate')

  return (
    <SubTitle title={t('setting_download_file_name')}>
      <View style={styles.list}>
        {TYPES.map(item => <Item key={item} id={item} />)}
      </View>
      {
        type === '自定义'
          ? <View style={styles.template}>
              <InputItem
                label={t('setting_download_template')}
                value={template}
                placeholder={t('setting_download_template_placeholder')}
                onChanged={(text) => { updateSetting({ 'download.fileNameTemplate': text }) }}
              />
            </View>
          : null
      }
      <Text size={12} color={theme['c-font-label']} style={styles.tip}>
        {type === '自定义' ? t('setting_download_template_tip') : t('setting_download_file_name_tip')}
      </Text>
    </SubTitle>
  )
})

const styles = StyleSheet.create({
  list: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  template: {
    marginTop: 4,
    paddingLeft: 25,
    paddingRight: 25,
  },
  tip: {
    marginTop: 6,
    paddingRight: 15,
  },
})
