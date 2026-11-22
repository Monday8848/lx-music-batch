import { memo, useState } from 'react'
import { View, ScrollView } from 'react-native'

import Button from '@/components/common/Button'
import { createStyle } from '@/utils/tools'
import { useTheme } from '@/store/theme/hook'
import Text from '@/components/common/Text'
import { useI18n } from '@/lang'
import ModalContent from './ModalContent'
import { hideModal } from '@/core/version'
import { baseVersion, getBatchVersion } from '@/config/batch'
import { getAbi, getBuildTime, getVersionCode } from '@/utils/nativeModules/appInfo'

const pad = (n: number) => (n < 10 ? `0${n}` : `${n}`)

const formatBuildTime = (ts: number) => {
  if (!ts) return ''
  const d = new Date(ts)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

// 只列改动，不重复上游已有功能，避免弹窗变成一篇长文
const FEATURES = [
  'about_feature_batch',
  'about_feature_retry',
  'about_feature_lyric',
  'about_feature_log',
  'about_feature_wifi',
] as const

const InfoRow = ({ label, value }: { label: string, value: string }) => (
  <View style={styles.row}>
    <Text style={styles.label}>{label}</Text>
    <Text selectable style={styles.value}>{value}</Text>
  </View>
)

/**
 * [BATCH] 「关于本改版」弹窗。
 * 原 VersionModal 是更新弹窗：下拉进度、忽略版本、下载并安装上游 APK。
 * 更新检查关闭后，这里只读本地信息，没有任何网络请求和安装入口。
 */
const VersionModal = ({ componentId }: { componentId: string }) => {
  const theme = useTheme()
  const t = useI18n()

  // 同步原生调用只在首次渲染取一次，避免每次重渲染都读一遍 PackageManager
  const [info] = useState(() => ({
    version: getBatchVersion(),
    versionCode: getVersionCode(),
    buildTime: formatBuildTime(getBuildTime()),
    abi: getAbi(),
  }))

  return (
    <ModalContent>
      <View style={styles.main}>
        <Text style={styles.title}>{t('about_title')}</Text>
        <ScrollView style={styles.content} keyboardShouldPersistTaps={'always'}>
          <View style={styles.block}>
            <InfoRow label={t('version_label_current_ver')} value={info.version} />
            <InfoRow label={t('about_label_upstream')} value={baseVersion} />
            {info.buildTime ? <InfoRow label={t('about_label_build')} value={info.buildTime} /> : null}
            {info.abi ? <InfoRow label={t('about_label_abi')} value={info.abi} /> : null}
            {info.versionCode ? <InfoRow label={t('about_label_version_code')} value={`${info.versionCode}`} /> : null}
          </View>

          <View style={styles.block}>
            <Text style={styles.label}>{t('about_label_features')}</Text>
            {FEATURES.map(key => (
              <Text key={key} selectable style={styles.feature}>· {t(key)}</Text>
            ))}
          </View>

          <View style={styles.block}>
            <Text style={styles.label}>{t('about_label_credit')}</Text>
            <Text selectable style={styles.desc}>{t('about_credit', { ver: baseVersion })}</Text>
          </View>

          <View style={styles.block}>
            <Text style={styles.label}>{t('about_label_disclaimer')}</Text>
            <Text selectable style={styles.desc}>{t('about_disclaimer')}</Text>
          </View>
        </ScrollView>
      </View>
      <View style={styles.btns}>
        <Button
          style={{ ...styles.btn, backgroundColor: theme['c-button-background'] }}
          onPress={() => { hideModal(componentId) }}
        >
          <Text color={theme['c-button-font']}>{t('version_btn_close')}</Text>
        </Button>
      </View>
    </ModalContent>
  )
}

const styles = createStyle({
  main: {
    flexShrink: 1,
    marginTop: 15,
    marginLeft: 15,
    marginRight: 15,
    marginBottom: 10,
  },
  content: {
    flexGrow: 0,
  },
  title: {
    fontSize: 18,
    textAlign: 'center',
    marginBottom: 15,
  },
  block: {
    marginBottom: 14,
  },
  row: {
    flexDirection: 'row',
    marginBottom: 4,
  },
  label: {
    fontSize: 14,
    marginBottom: 2,
  },
  value: {
    fontSize: 14,
    marginLeft: 4,
  },
  desc: {
    fontSize: 13,
    lineHeight: 19,
  },
  feature: {
    fontSize: 13,
    lineHeight: 20,
  },
  btns: {
    flexDirection: 'row',
    justifyContent: 'center',
    paddingBottom: 15,
    paddingLeft: 15,
  },
  btn: {
    flex: 1,
    paddingTop: 10,
    paddingBottom: 10,
    paddingLeft: 10,
    paddingRight: 10,
    alignItems: 'center',
    borderRadius: 4,
    marginRight: 15,
  },
})

export default memo(VersionModal)
