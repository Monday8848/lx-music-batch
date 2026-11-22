import { memo } from 'react'

import Section from '../../components/Section'
import QualitySelect from './QualitySelect'
import FileNameType from './FileNameType'
import LyricOptions from './LyricOptions'
import MetaOptions from './MetaOptions'
import BehaviorOptions from './BehaviorOptions'
import SavePath from './SavePath'
import LogOptions from './LogOptions'
import { useI18n } from '@/lang'

export default memo(() => {
  const t = useI18n()

  return (
    <Section title={t('setting_download')}>
      <QualitySelect />
      <FileNameType />
      <LyricOptions />
      <MetaOptions />
      <BehaviorOptions />
      <SavePath />
      <LogOptions />
    </Section>
  )
})
