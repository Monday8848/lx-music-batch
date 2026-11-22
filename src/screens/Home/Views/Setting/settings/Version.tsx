import { memo } from 'react'
import { StyleSheet, View } from 'react-native'

import Section from '../components/Section'
import SubTitle from '../components/SubTitle'
import Button from '../components/Button'

import { useI18n } from '@/lang'
import Text from '@/components/common/Text'
import { showModal } from '@/core/version'
import { baseVersion, getBatchVersion } from '@/config/batch'

/**
 * [BATCH] 原先这里是「软件更新」——会联网检查上游版本、弹更新提示、下载上游 APK。
 * 现在改为纯静态的「关于本改版」：不联网、没有版本状态机，点开只是一个信息弹窗。
 */
export default memo(() => {
  const t = useI18n()

  return (
    <Section title={t('about_title')}>
      <SubTitle title={getBatchVersion()}>
        <View style={styles.desc}>
          <Text size={14}>{t('about_label_upstream')}{baseVersion}</Text>
          <Text size={14}>{t('about_label_unofficial')}</Text>
        </View>
        <View style={styles.btn}>
          <Button onPress={showModal}>{t('about_btn_detail')}</Button>
        </View>
      </SubTitle>
    </Section>
  )
})

const styles = StyleSheet.create({
  desc: {
    marginBottom: 8,
  },
  btn: {
    flexDirection: 'row',
  },
})
