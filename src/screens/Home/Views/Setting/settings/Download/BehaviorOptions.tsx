import { memo, useMemo } from 'react'
import { StyleSheet, View } from 'react-native'

import CheckBoxItem from '../../components/CheckBoxItem'
import SubTitle from '../../components/SubTitle'
import CheckBox from '@/components/common/CheckBox'
import Text from '@/components/common/Text'
import { useSettingValue } from '@/store/setting/hook'
import { updateSetting } from '@/core/common'
import { applyConcurrencyChange } from '@/core/download'
import { useI18n } from '@/lang'
import { useTheme } from '@/store/theme/hook'

const CONCURRENT = [1, 2, 3, 4, 5]
const RETRY = [0, 1, 2, 3]

const NumberItem = ({ value, current, onChange }: {
  value: number
  current: number
  onChange: (value: number) => void
}) => {
  const isActive = useMemo(() => current === value, [current, value])
  return (
    <CheckBox
      marginRight={14}
      marginBottom={4}
      check={isActive}
      label={String(value)}
      onChange={() => { onChange(value) }}
      need
    />
  )
}

const Row = ({ label, children }: { label: string, children: React.ReactNode }) => {
  const theme = useTheme()
  return (
    <View style={styles.row}>
      <Text size={14} color={theme['c-font']} style={styles.rowLabel}>{label}</Text>
      <View style={styles.rowItems}>{children}</View>
    </View>
  )
}

export default memo(() => {
  const t = useI18n()
  const theme = useTheme()
  const skipExist = useSettingValue('download.isSkipExist')
  const scanMedia = useSettingValue('download.isScanMedia')
  const wifiOnly = useSettingValue('download.isWifiOnly')
  const concurrent = useSettingValue('download.concurrent')
  const maxRetry = useSettingValue('download.maxRetry')

  return (
    <SubTitle title={t('setting_download_behavior')}>
      <CheckBoxItem
        check={skipExist}
        label={t('setting_download_skip_exist')}
        onChange={check => { updateSetting({ 'download.isSkipExist': check }) }}
      />
      <CheckBoxItem
        check={scanMedia}
        label={t('setting_download_scan_media')}
        onChange={check => { updateSetting({ 'download.isScanMedia': check }) }}
      />
      <CheckBoxItem
        check={wifiOnly}
        label={t('setting_download_wifi_only')}
        onChange={check => { updateSetting({ 'download.isWifiOnly': check }) }}
      />
      <Row label={t('setting_download_concurrent')}>
        {CONCURRENT.map(item => (
          <NumberItem
            key={item}
            value={item}
            current={Number(concurrent)}
            onChange={value => {
              updateSetting({ 'download.concurrent': value })
              applyConcurrencyChange()
            }}
          />
        ))}
      </Row>
      <Row label={t('setting_download_retry')}>
        {RETRY.map(item => (
          <NumberItem
            key={item}
            value={item}
            current={Number(maxRetry)}
            onChange={value => { updateSetting({ 'download.maxRetry': value }) }}
          />
        ))}
      </Row>
      <Text size={12} color={theme['c-font-label']} style={styles.tip}>{t('setting_download_behavior_tip')}</Text>
    </SubTitle>
  )
})

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: 25,
    paddingRight: 15,
    marginBottom: 4,
  },
  rowLabel: {
    width: 96,
  },
  rowItems: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    flexShrink: 1,
  },
  tip: {
    marginTop: 6,
    paddingLeft: 25,
    paddingRight: 15,
  },
})
