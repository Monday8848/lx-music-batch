import { memo } from 'react'
import { View } from 'react-native'

import SubTitle from '../../components/SubTitle'
import Text from '@/components/common/Text'
import { useTheme } from '@/store/theme/hook'
import { useI18n } from '@/lang'
import { createStyle } from '@/utils/tools'

export default memo(() => {
  const t = useI18n()
  const theme = useTheme()

  return (
    <SubTitle title={t('setting_download_path')}>
      <View style={styles.content}>
        <Text size={14} color={theme['c-primary']}>Download/LXMusic/</Text>
        <Text size={13} color={theme['c-font-label']}>{t('setting_download_path_value')}</Text>
      </View>
    </SubTitle>
  )
})

const styles = createStyle({
  content: {
    paddingLeft: 0,
    marginTop: 2,
    marginBottom: 4,
  },
})
