import versionActions from '@/store/version/action'
import versionState, { type InitState } from '@/store/version/state'
import { saveIgnoreVersion } from '@/utils/data'
import { showVersionModal } from '@/navigation'
import { Navigation } from 'react-native-navigation'

export const showModal = () => {
  if (versionState.showModal) return
  versionActions.setVisibleModal(true)
  showVersionModal()
}

export const hideModal = (componentId: string) => {
  if (!versionState.showModal) return
  versionActions.setVisibleModal(false)
  void Navigation.dismissOverlay(componentId)
}

/**
 * [BATCH] 更新检查已关闭：不联网、不比较版本、不弹更新提示。
 *
 * 保留该导出是因为 src/core/init/index.ts 与 src/navigation/components/PactModal.tsx
 * 在启动流程里会调用它——函数内部直接返回，调用方一行都不用改，
 * 也就不会在每次冷启动时对着 8 个上游地址打 24 个注定失败的请求。
 */
export const checkUpdate = async() => {
  if (versionState.versionInfo.isLatest) return
  versionActions.setVersionInfo({
    status: 'idle',
    isLatest: true,
    isUnknown: false,
    newVersion: null,
  })
}

/**
 * [BATCH] 站内下载已关闭，保留空导出以免调用方编译失败。
 * 真正的下载逻辑已从 @/utils/version 移除，这里没有任何可执行的网络请求。
 */
export const downloadUpdate = () => {
  // 已关闭，故意留空：任何调用都不会触发网络请求
}

export const setIgnoreVersion = (version: InitState['ignoreVersion']) => {
  versionActions.setIgnoreVersion(version)
  saveIgnoreVersion(version)
}
