import { version } from '../../package.json'
import { getVersionName } from '@/utils/nativeModules/appInfo'

/**
 * [BATCH] 改版身份信息，跟版时这两个值都不用改：
 * - 基于上游版本：来自 package.json 的 version，随上游合并自动变化
 * - 改版版本号：来自 android/app/build.gradle 的 versionName（如 1.9.3-batch.1）
 *
 * 刻意不在模块顶层调用原生模块——原生 bridge 就绪前调用会拿到空值。
 */
export const baseVersion = version

export const getBatchVersion = () => getVersionName() || version
