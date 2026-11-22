import { NativeModules } from 'react-native'

interface AppInfoNativeModule {
  getVersionName: () => string
  getVersionCode: () => number
  getBuildTime: () => number
  getAbi: () => string
}

// 原生模块读取失败时统一返回兜底值，保证「关于本改版」页面在任何情况下都能打开
const native = NativeModules.AppInfo as AppInfoNativeModule | undefined

export const getVersionName = (): string => {
  try {
    return native?.getVersionName() ?? ''
  } catch {
    return ''
  }
}

export const getVersionCode = (): number => {
  try {
    return native?.getVersionCode() ?? 0
  } catch {
    return 0
  }
}

export const getBuildTime = (): number => {
  try {
    return native?.getBuildTime() ?? 0
  } catch {
    return 0
  }
}

export const getAbi = (): string => {
  try {
    return native?.getAbi() ?? ''
  } catch {
    return ''
  }
}
