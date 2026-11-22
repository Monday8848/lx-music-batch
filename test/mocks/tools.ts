let asked = 0

/** 测试环境默认已授权，同时记录调用次数便于断言 */
export const requestStoragePermission = async() => {
  asked++
  return true
}

export const getStoragePermissionAsked = () => asked
