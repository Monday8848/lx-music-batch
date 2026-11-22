/**
 * [BATCH] 应用内更新检查已关闭。
 *
 * 本改版跟随上游 lyswhut/lx-music-mobile 手动跟进发版（见 README 的《上游跟进手册》），
 * 不在应用内联网检查版本。原实现会依次拉取上游 8 个 version.json（raw.githubusercontent、
 * npm、jsdelivr×3、gitee、cdn.stsky.cn），并在用户确认后从上游 GitHub Releases 下载 APK——
 * 上游包名是 cn.toside.music.mobile、签名也不同，装上去不会覆盖本改版，而是并存成第二个应用。
 *
 * 这里保留三个函数的签名（调用方不必改动），但一律直接拒绝：
 * 无论界面怎么变、将来谁误调用，都不存在下载到上游包的代码路径。
 * 底层安装能力仍完整保留在 @/utils/nativeModules/utils 的 installApk 里，
 * 将来若要接自己的发布源，只需把下面三个函数恢复实现即可。
 */
const DISABLED_MSG = 'UPDATE_CHECK_DISABLED'

export const getVersionInfo = async() => {
  throw new Error(DISABLED_MSG)
}

export const downloadNewVersion = async() => {
  throw new Error(DISABLED_MSG)
}

export const updateApp = async() => {
  throw new Error(DISABLED_MSG)
}
