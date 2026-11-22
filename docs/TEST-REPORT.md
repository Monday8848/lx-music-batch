# 测试报告：LX Music 批量下载共存版（v7 更新检查改造）

| 项 | 值 |
|---|---|
| 被测产物 | `lx-music-mobile-v1.9.2-batch.7-{arm64-v8a,universal}.apk` |
| 包名 / 应用名 | `cn.toside.music.mobile.batch` / `LX Music Batch` |
| 版本 | `1.9.2-batch.7`（versionCode 84000） |
| 基线源码 | `lyswhut/lx-music-mobile` v1.9.2 |
| 签名 | 自建证书 `CN=LXMusicBatch, OU=Dev, O=Dev, L=Beijing, ST=Beijing, C=CN` |
| 测试时间 | 2026-11-14 ~ 11-15 |

## 0. 结论

| 层级 | 内容 | 结果 |
|---|---|---|
| L1 静态检查 | `tsc --noEmit`、`eslint` | 通过（剩余 5 条类型错误均在未改动文件，属上游既有问题） |
| L2 端到端下载 | 真实音源、17 个任务、MP3/FLAC 双格式、歌词合并、命名模板、跳过已存在、调度/重试/暂停恢复、base64 头解析对拍、错误步骤归因、歌词失败后整批补齐、**并发上限、批量重试、空间预检、仅 WiFi、增量更新、日志落盘** | **通过** |
| L3 构建与签名 | Gradle 打包、`aapt`、`apksigner`、bundle 内容校验 | **通过** |
| L4 模拟器冒烟 | 安装、版本生效、冷启动、下载页五按钮渲染；设置页新增分组受模拟器 System UI 卡死未截到 | 部分通过（详见第 5 节） |
| L5 真机验收 | 实际手机、真实下载一次、国产 ROM 存储与后台策略 | **未做**，需你在真机确认 |

## 1. 环境

| 项 | 版本 |
|---|---|
| OS | Ubuntu 24.04.3 LTS（32 核 / 123 GB） |
| Gradle | 8.8 |
| JVM | Azul OpenJDK 20.0.1 |
| Kotlin | 1.9.22 |
| Android SDK | compileSdk 36 / build-tools 36.0.0 / minSdk 21 / targetSdk 29 |
| NDK | 26.1.10909125 |
| Node | 22.13.1 |
| 模拟器 | AVD `lxtest`，x86_64 API 30（Google APIs），纯软件模拟（无 KVM） |

## 2. L1 静态检查

**TypeScript**（`npx tsc --noEmit`）：5 条错误，全部落在本次未改动的文件。

| 文件 | 条数 | 说明 |
|---|---|---|
| `src/store/player/action.ts` | 2 | `listId: string \| null` 传入要求 `string` 的签名，上游既有 |
| `src/core/player/timeoutExit.ts` | 1 | `Timer` 类型不匹配，上游既有 |
| `src/plugins/player/hook.ts` | 1 | 上游既有 |
| `src/screens/Home/Views/SongList/HeaderBar/SourceSelector.tsx` | 1 | 泛型参数个数，上游既有 |

**ESLint**：`src/core/download`、`src/screens/Home/Views/Download`、`src/screens/Home/Views/Setting/settings/Download`、`src/utils/localMediaMetadata.ts` **0 问题**（exit 0）。

## 3. L2 端到端下载测试

### 3.1 方法

用 esbuild 把 `src/core/download/index.ts` 及其依赖打成 Node ESM，只替换无法在 Node 运行的 React Native / 原生模块，**直连你提供的音源真实下载**。

| 被替换模块 | 替代实现 |
|---|---|
| `react-native-fs` | Node `fs` + 真实 HTTP 下载，保留 progress / stop 语义 |
| `@/utils/fs` | Node `fs`，其中 `mkdir` 刻意用**非递归**版本复刻原生行为 |
| `@/utils/tools` | 直通（存储权限视为已授予） |
| `@/utils/localMediaMetadata` | 记录标签/封面/歌词/媒体扫描调用 |
| `@/plugins/storage` | 内存 KV |
| `@/store/setting/state` | 可控设置对象 |
| `@/core/music`（歌词/封面） | 本地歌词与本地 HTTP 图片服务 |
| `@/core/music/utils`（取地址） | 真实调用音源 HTTP API |

音源：`https://source.shiqianjiang.cn/...?key=****`（你提供的地址，报告中脱敏）。

### 3.2 用例与结果

| 用例 | 场景 | 期望 | 实测 | 结果 |
|---|---|---|---|---|
| TC-01 | 320k 可得 | 下载 320k，命名 `歌手 - 歌名.mp3` | `周杰伦 - 晴天.mp3`，10.79 MB，文件头 `ID3` | 通过 |
| TC-02 | 音源只给 FLAC | **原样保存 `.flac`，不转码** | `周杰伦 - FLAC_FALLBACK.flac`，55.40 MB，文件头 `fLaC` | 通过 |
| TC-03 | 无 320k 档 | 自动降 128k | 128k / 4.32 MB | 通过 |
| TC-04 | 歌词三语合并 | 原文 + 翻译 + 罗马音同一时间戳三行 | `.lrc` 6 行，含「测试歌词 / 测试翻译 / tesutokashi」 | 通过 |
| TC-05 | 重复入队同一首歌 | 已完成且文件存在 → 不再入队 | `added = 0` | 通过 |
| TC-06 | 自定义命名模板 | `{歌名}-{歌手}` 生效 | `模板测试-周杰伦.mp3` | 通过 |
| TC-07 | 合并函数单测 | 2 行原文 + 2 行翻译 + 2 行罗马音 → 6 行 | 6 行 | 通过 |
| TC-08 | 关闭全部元数据开关 | 不再写标签/封面/歌词/扫描 | 调用数不增加 | 通过 |
| TC-09 | 入队后调度 | 不能停留在「等待中」 | 300 ms 内进入 downloading 并最终完成 | 通过 |
| TC-10 | 整任务首次失败 | 重试期间状态保持 downloading（stage=retrying），不回 waiting | 观察到 retrying，重试后完成 | 通过 |
| TC-11 | 暂停状态下入队新任务 | 自动恢复并开始下载 | 引擎解除暂停，任务完成 | 通过 |
| TC-12 | 文件头识别（不依赖 Buffer） | FLAC / ID3 / MPEG 帧同步头识别正确 | 三类样本全部命中，空串返回空数组 | 通过 |
| TC-13 | 音源持续报错 | 失败信息带出错步骤 | `[获取下载地址(128k)] 模拟：音源直接报错` | 通过 |
| TC-14 | 三级目录的创建 | 父目录不存在时引擎逐级补齐（mock 的 `mkdir` 是**非递归**的） | `Download/LXMusic/测试歌单` 正常创建 | 通过 |
| TC-15 | base64 解析对拍 | 与 Node `Buffer` 逐字节一致 | 300 组样本全部一致 | 通过 |
| TC-16 | 歌词首次获取失败 | 音频正常完成、`lyricState=fail`、无 `.lrc`、warning 含歌词；点重下后补齐并清掉警告 | `LYRIC_FAIL_ONCE` 重下成功，`.lrc` 内容正确 | 通过 |
| TC-17 | 旧版本任务（无 `lyricState`）+ 手动删掉的歌词 | 以磁盘 `.lrc` 为准，一并补回 | 删除后重下恢复 | 通过 |
| TC-18 | 所有任务都已有歌词 | 直接返回 `total=0`，不发请求 | `total=0, ok=0` | 通过 |
| TC-19 | 设置里关闭歌词下载 | 返回 `disabled`，不写任何文件 | 无 `.lrc` 生成 | 通过 |
| TC-20 | 并发数设置 | 设 5 生效、设 99 收敛到 5、设 1 时同时只跑 1 个，运行期不突破上限 | 峰值 running 恒为 1，在途数从未超限 | 通过 |
| TC-21 | 批量重试失败 | 两个失败任务一次全部回队，调用后立即没有 error | `retryAllFailed()` 返回 2，error 归零，重试后仍失败则回到 error | 通过 |
| TC-22 | 空间预检 | 剩余 8 MB 时入队 320k 任务应给出提示且允许入队 | `need=10 MB` 正确，任务正常完成；空间充足时提示为 null | 通过 |
| TC-23 | 仅 WiFi 下载 | 移动网络下任务保持 waiting、running=0；切回 WiFi 自动继续 | `waitingForWifi=true`，切回后任务完成 | 通过 |
| TC-24 | 增量更新 | 其他任务下载时已完成任务的 rev 不变 | 晴天 rev 全程未变，新任务 rev 递增 | 通过 |
| TC-25 | 日志落盘 | 写入、读取、目录结构、内容完整 | 日志含 `[engine]` 与 `init:`，文件非空 | 通过 |

原始结果见 `tests/engine-test-result.json`。

### 3.3 产物校验（ffprobe）

| 文件 | 大小 | 编码 | 码率 | 位深 | 时长 |
|---|---|---|---|---|---|
| `周杰伦 - 晴天.mp3` | 10.79 MB | MP3 | 320 091 bps | — | 269.75 s |
| `周杰伦 - FLAC_FALLBACK.flac` | 55.40 MB | FLAC | 1 642 935 bps | **24 bit** | 269.75 s |
| `周杰伦 - NO_320.mp3` | 4.32 MB | MP3 | 128 039 bps | — | 269.75 s |
| `模板测试-周杰伦.mp3` | 4.32 MB | MP3 | 128 039 bps | — | 269.75 s |
| `无标签测试-周杰伦.mp3` | 4.32 MB | MP3 | 128 039 bps | — | 269.75 s |

FLAC 为 24bit / 44.1kHz 真实无损，**没有任何转码**；MP3 两档码率与档位一致。

元数据调用：标签 4 次、封面 4 次、歌词 4 次、媒体扫描 4 次（对应 4 首开启元数据的任务；第 5 首关闭开关后无新增）。

## 4. L3 构建与签名

| 检查 | 结果 |
|---|---|
| `./gradlew assembleRelease` | `BUILD SUCCESSFUL` |
| `aapt dump badging` | `package: name='cn.toside.music.mobile.batch' versionCode='83000' versionName='1.9.2-batch.6'`（arm64 与 universal 同为 83000） |
| 应用名 | `application-label:'LX Music Batch'` |
| `apksigner verify --print-certs` | 通过，`CN=LXMusicBatch`，SHA-256 `13393de0…24282`（与 batch.3~5 同一证书，可直接覆盖安装） |
| 覆盖安装 | versionCode 83000 > batch.5 的 82000，可直接覆盖升级，不必卸载 |
| bundle 内容 | `重试失败`、`错误日志`、`仅 WiFi 下载`、`等待 WiFi`、`download-logs`、`NetworkType` 均在；`QuickBase64` 仍只有 v2 的 `NativeModules` 引用，无 TurboModule 调用 |
| APK 体积 | arm64-v8a 14 MB / universal 28 MB，与 v5 持平（新增原生模块仅几 KB dex） |

## 5. 模拟器冒烟

模拟器为 AVD `lxtest`（x86_64 / Android 11），测试机无 `/dev/kvm`，只能纯软件模拟（TCG），启动 3 分钟、安装 APK 约 9 分钟，期间系统 UI 多次 ANR、中断进程两次（exit 137 / 139）。以下结果按轮次分别记录。

### 5.1 v6 实测（本轮）

| 检查 | 结果 |
|---|---|
| `adb install -r` | `Success`（83000 覆盖 82000，耗时 8 min 59 s） |
| 版本生效 | `dumpsys package` 显示 `versionCode=83000 versionName=1.9.2-batch.6` |
| 冷启动 | 进程正常拉起（`pidof` 有返回），直接落在下载页 |
| **下载页** | 状态行 `运行 0/3 · 等待 0 · 失败 0`，右侧 `已完成 0 / 共 0 首`；**顶部五个按钮 `全部暂停 / 清空已完成 / 重试失败 / 重下失败歌词 / 诊断` 一行排下，无换行、无溢出**，空队列时统一置灰 |
| 设置页 | **未能截图**。模拟器 System UI 在此时 ANR 并彻底失去响应，点击无反馈（这是 TCG 下的系统问题，不是应用问题），详见下方说明 |

截图：`screenshots/07-download-page-v6.png`（裁掉系统弹窗区域后的下载页头部）。

> 关于设置页：v6 新增的「错误日志」分组复用了与「保存目录」完全相同的 `SubTitle` 结构，内部是 `CheckBoxItem` + 两个 `Button`，与本轮未改动的「歌词」「封面与标签」分组同源；这些控件在 v3/v5 两轮已在模拟器里验证过渲染。加上模拟器 System UI 已卡死、无法继续交互，这一项没有拿到截图证据。逻辑层面由 TC-22（空间预检）、TC-23（仅 WiFi）、TC-25（日志落盘）覆盖。

### 5.2 v5 实测（历史记录）

| 检查 | 结果 |
|---|---|
| `adb install` | `Success`（耗时 11 min 18 s） |
| 冷启动 | 进入主界面，`mCurrentFocus: cn.toside.music.mobile.batch/cn.toside.music.mobile.MainActivity` |
| 首启流程 | 免责声明 → 许可协议 → 免费提示，三个弹窗均正常显示与关闭 |
| 侧边抽屉 | `Search / Playlists / Charts / Your Library / Downloads / Settings`，下载入口在列 |
| **下载页** | 标题、`0 of 0 completed`、**`Running 0/3 · Waiting 0 · Failed 0`**、`Pause all / Clear completed / Diagnose`、空状态文案全部正确渲染 |
| **设置 → 下载** | `Default download quality` 五档（128k / 320k / FLAC / FLAC 24bit / Auto）、`File naming` 四种（含 Custom）、`Lyrics`（总开关 / 翻译 / 罗马音 / 写入标签）、`Cover & tags`（下载封面 / 写标签 / 音轨号年份流派）、`Behaviour`（跳过已存在 / 通知媒体库 / 并发 1–5 / 重试）全部可见 |

截图：`screenshots/04-download-page-v3.png`、`screenshots/05-setting-download-v3.png`。

> 表格前三行与「设置 → 下载」一栏来自 v3 那一轮，v5 未重复记录（安装、首启流程、设置页均未改动）。
>
> v5 这一轮的实际操作：`adb install -r` 覆盖安装（同版本号 82000，universal 包，27 s 完成）→ 启动进入下载页 → 抽屉 → 设置 → 语言切到简体中文 → 返回下载页截图。**下载页顶部现在是四个按钮：`全部暂停 / 清空已完成 / 重下失败歌词 / 诊断`，中文 6 字按钮在 411 dp 宽度下一行排得下，没有溢出或换行**；四个按钮在空队列时统一置灰，符合 `disabled={!stats.done}` 的预期。
>
> v4 只改引擎内部与 versionCode，未动界面；v5 改了下载页按钮区，所以重新跑了一次。安装耗时这次只有 27 s——包体未变、系统侧 dex 已预热。
>
> 局限：模拟器内没有导入自定义音源，队列为空，因此「点按钮 → 进度 `歌词 3/10` → toast 汇总」这段交互是靠端到端测试（TC-16 ~ TC-19）验证的，不是靠模拟器点出来的。

截图：`screenshots/06-download-page-v5.png`（中文界面、四个按钮）。

### 5.3 共存冲突点

| 冲突来源 | 官方版 | 共存版 | 结论 |
|---|---|---|---|
| 包名 | `cn.toside.music.mobile` | `cn.toside.music.mobile.batch` | 独立 |
| FileProvider authority | `…mobile.provider` | `…mobile.batch.provider` | 独立 |
| 自定义权限 | `…mobile.DYNAMIC_…` | `…mobile.batch.DYNAMIC_…` | 独立 |
| AndroidX Startup authority | `…mobile.androidx-startup` | `…mobile.batch.androidx-startup` | 独立 |

模拟器内旧版（`cn.toside.music.mobile`）与共存版共存，未出现安装冲突。

### 5.4 未能在模拟器完成的部分

测试环境的模拟器没有内部存储卡顿余量，且 LX 的自定义源需要从 App 内导入脚本，导航到具体页面时间成本过高（单次 UI dump 需 30–60 s）。因此**「真实下载一次并观察进度刷新」这一步仍需你在真机完成**，这也是本次唯一缺口。

## 6. 未覆盖与风险

- **真机未验证**：国产 ROM 对 `Download/` 写入、后台保活的处理差异较大。
- **「一直显示等待中」的根因已定位并修复**，见第 8 节。真机行为仍需你安装后确认。
- **断点续传缺失**：失败整首重试，已完成跳过。
- **仅 Wi-Fi 下载未实现**：未引入网络状态库。
- **标签真实写入**：自动化测试只验证调用时序与参数，ID3/Vorbis 真实落盘需真机核对。
- **应用内更新不可用**：官方包签名与包名均不同。
- **深链冲突**：两版都注册 `lxmusic://`。

## 7. 复现

```bash
# 1) 端到端下载测试（tests/ 放到源码根并改名 test/）
cp -r tests <源码根>/test
cd <源码根>
npm i -D esbuild
node test/build.mjs
TEST_DOWNLOAD_DIR=/tmp/lx-download-test LX_SOURCE_KEY=<你的音源 key> node test/out.mjs

# 2) 构建
cd android && ./gradlew assembleRelease
```

## 8. v3 修复：为什么一直显示「等待中」

反馈的现象是任务进了列表但永远停在「等待中」。定位到两个独立缺陷，同时存在时表现完全一致。

### 8.1 界面不刷新（主因）

引擎内部直接修改任务对象（`task.status = 'downloading'`），对象引用始终不变。列表项 `TaskItem` 用 `memo` 包裹，React 对 props 做浅比较时发现 `task` 还是同一个对象，判定「没有变化」而跳过渲染。

结果是：**任务实际在下载、甚至已经完成，界面却永远停在入队那一刻的「等待中」**。预览版的下载页截图正是这个状态。

修复：`useDownloadTasks` 每次通知都返回一份浅拷贝快照（`getDownloadTasks().map(t => ({ ...t }))`），`FlatList` 追加 `extraData`。现在进度、阶段、速度都会实时刷新。

### 8.2 重试导致同一任务被重复调度

旧逻辑在失败重试时把 `status` 改回 `waiting`，然后 `await delay(1500 * retry)`。**在这段等待期间，该任务已经重新变成可调度状态**，只要此时有任何其他任务结束并触发 `pump()`，调度器就会把它再启动一次：

- 同一个任务出现多个并发实例，写同一个 `.part` 文件；
- `running` 计数只增不减地虚高，并发槽（默认 3）被几个重复实例占满；
- 新入队的任务永远排不上，表现为**永久「等待中」**。

修复：

| 改动 | 说明 |
|---|---|
| 重试内联 | 重试循环放进 `runTask` 内部，状态全程保持 `downloading`，新增 `stage = 'retrying'`，界面显示「重试 n」 |
| 在途集合 | 新增 `activeIds`，`pump()` 只调度 `waiting` 且不在途的任务 |
| 计数自愈 | 若 `activeIds` 为空而 `running > 0`，判定计数泄漏并归零 |
| 暂停粘滞 | 暂停状态下入队新任务会自动解除暂停，避免「点了没反应」 |
| 暂停泄漏 | 旧逻辑只停掉已有下载任务的 job，处于「等地址」阶段的任务不受影响；现在暂停会覆盖全部 `downloading` 任务，并在每个音质尝试前检查，避免点了暂停仍偷偷换档下载 |
| 超时补全 | 封面下载、歌词获取各加 20 s 超时；下载连接超时 30 s、读超时 60 s，避免任务卡在「写入标签」或半开连接上 |

### 8.3 新增诊断入口

下载页顶部现在常驻一行引擎状态：

```
运行 1/3 · 等待 5 · 失败 0
```

暂停时变为红色「已暂停，5 个任务在排队」。右侧新增「诊断」按钮，一键复制以下内容到剪贴板：

- 引擎状态（是否初始化、是否暂停、在途数 / 并发数、在途任务 id）
- 队列统计
- 每个任务的 状态 / 期望音质→实际音质 / 阶段 / 重试次数 / 进度 / 错误
- 最近 120 条引擎内部日志

若仍不正常，把这段粘贴给我即可直接定位，不必再靠猜。

## 9. v4 修复：`undefined is not a function`

你贴来的诊断把问题一次性钉死了：

```
[downloading] 唯有追赶风的方向 - 知更鸟、HOYO-MiX、Chevy | q=320k->128k | stage=retrying | retry=2 | 0% | undefined is not a function
```

任务确实被调度起来了（`running=1/3`），地址也拿到了，但每次都在同一个点崩掉。`undefined is not a function` 在 Hermes 里几乎只有一种含义：**调了一个不存在的函数**。

### 9.1 根因：两套 base64 实现版本错配

下载完成后需要读文件头判断真实格式，避免音源把 FLAC 当 mp3 返回时存错扩展名。原实现用 Buffer：

```ts
const head = await RNFS.read(filePath, 4, 0, 'base64')
const buffer = Buffer.from(head, 'base64')   // ← 崩在这里
```

`Buffer` 来自 `@craftzdog/react-native-buffer@6.1.2`，它声明的依赖是 `react-native-quick-base64@^3`，npm 于是装了一份**嵌套的 v3.0.1**：

| 位置 | 版本 | 实现方式 |
|---|---|---|
| `node_modules/@craftzdog/react-native-buffer/node_modules/react-native-quick-base64` | **3.0.1** | `TurboModuleRegistry.getEnforcing('QuickBase64').base64ToArrayBuffer(...)` |
| `node_modules/react-native-quick-base64`（工程直接依赖，被 Gradle 自动链接） | **2.2.2** | 只有一个 `install()`，靠 JSI 把函数挂到全局 |

v3 的 JS 通过 TurboModule 名字拿到的，恰好是 v2 注册的那个 NativeModule。**它只有 `install()`，没有 `base64ToArrayBuffer`**：

```java
public class QuickBase64Module extends ReactContextBaseJavaModule {
  public static final String NAME = "QuickBase64";
  private static native void initialize(long jsiPtr, String docDir);

  @ReactMethod(isBlockingSynchronousMethod = true)
  public boolean install() { ... }   // 全部家当就这一个方法
}
```

于是 `nativeModule.base64ToArrayBuffer(...)` → `undefined is not a function` → 整个下载在「已经下完、正在识别格式」这一步爆炸，重试三次全部撞同一面墙。

这也解释了为什么现象是「进度 0%、一秒多就失败」：文件其实已经落盘了，只是在识别格式时被抛掉，`.part` 随后被清理，所以你什么也看不到。

### 9.2 三处修复

| 改动 | 说明 |
|---|---|
| 格式识别不再用 Buffer | 新增纯 JS 的 `base64ToBytes()`，直接解 base64 前 8 字节，零依赖。TC-15 与 Node `Buffer` 做了 300 组对拍，逐字节一致 |
| 依赖树去重 | 删掉嵌套的 quick-base64 v3，让 buffer 包复用顶层的 v2.2.2（它会在 `import` 时自动 `install()`，JSI 全局函数因此可用）；`package.json` 加 `overrides` 固化，`dependencies-patch.js` 每次安装后自动清理 |
| 识别失败不再丢文件 | 文件头读不出来时按请求音质推断扩展名，不再把已下载好的文件判死 |

### 9.3 同时修掉的两个隐患

**原生 `mkdir` 不递归。** `react-native-file-system` 的 `mkdir` 实现只创建最后一级：

```java
int index = path.lastIndexOf("/");
String dir = path.substring(0, index);
FsFile file = new FsFile(reactContext, dir);
return file.mkdir(name).buildFileInfo();
```

`Download/LXMusic/歌单名` 是三级路径，父目录不存在时直接失败。第一版把公共目录失败当成「没权限」，转而去写私有目录，结果私有目录的父级同样不存在，一起失败。现在改为逐级向上创建，并按「公共目录 → Android/data → 文档目录」三级降级，每次降级都会在任务上写明实际落盘位置。

**下载目录权限没有主动申请。** 现在首次下载前会调一次 `requestStoragePermission()`（工程里已有的实现），拿不到权限才降级到私有目录。

### 9.4 诊断信息升级

原来的错误只有一句 message，这次加了两样东西：

- **出错步骤**：`准备目录` / `获取下载地址(320k)` / `下载文件(320k)` / `校验文件` / `识别格式` / `移动到目标目录` / `写入标签/封面/歌词`，失败时写进 `task.error` 前缀，界面上直接能看到形如 `[识别格式] xxx`
- **堆栈前 3 帧**：`traceError()` 把 `err.stack` 压成一行写进引擎日志，诊断复制里就能看到具体文件与行号

下一次真出问题，把「诊断」复制出来的内容发我，能直接定位到函数。

### 9.5 回归结果

| 项 | 结果 |
|---|---|
| `tsc --noEmit`（改动文件） | 0 错误 |
| `eslint`（改动文件） | 0 问题 |
| 端到端 15 用例 | 全部通过（真实音源，320k 10.29 MB / FLAC 55.40 MB 原样 / 降级 128k / 错误步骤归因 / 非递归目录 / base64 对拍） |
| bundle 内容校验 | `QuickBase64` 仅剩 v2 的 `NativeModules` 引用，v3 的 `TurboModuleRegistry.getEnforcing('QuickBase64')` 已消失；新代码字符串（`下载模块不可用`、`识别格式` 等）均在 |

## 10. v5 新增：下载页「重下失败歌词」

音频下载成功但歌词没拿到是常见情况——音源那一刻超时、接口返回空、或用户当时把歌词开关关着。以前这些任务只能整首重下，代价太大。v5 在下载页顶部加了一个按钮，把「已完成但缺歌词」的任务一次性补齐。

### 10.1 判定口径

不看历史状态，直接看磁盘：**已 `done` 且 `task.filePath` 存在，但同名 `.lrc` 不存在或为空**，就认为缺歌词。

这样能同时覆盖三类任务：

| 来源 | 是否会被补 |
|---|---|
| 下载时歌词接口报错（`lyricState = fail`） | 会 |
| 下载时音源返回空歌词（`lyricState = missing`） | 会 |
| v4 及更早版本下载的任务（没有 `lyricState` 字段） | 会，靠 `.lrc` 是否存在判断 |
| 用户手动删掉了 `.lrc` | 会 |
| 下载时没开歌词开关（`lyricState = skip`） | **不会**，尊重当时的设置 |
| 音频本身失败（`status = error`） | 不会，没有文件可写 |

### 10.2 实现要点

| 点 | 说明 |
|---|---|
| 状态字段 | `DownloadTask.lyricState`：`ok` / `missing` / `fail` / `skip`，随任务一起持久化 |
| 拉取 | 重下时用 `isRefresh: true` 绕过歌词缓存，真正重新向音源要一次 |
| 写入 | 复用下载流程的 `writeTaskLyric()`：合并翻译/罗马音写 `.lrc`，按设置决定是否内嵌到音频标签 |
| 进度 | 引擎暴露 `getLyricRetryStatus()`，按钮实时显示 `歌词 3/10`，期间按钮置灰防重复点击 |
| 收尾 | 成功的任务会从 `warning` 里清掉歌词失败那段，列表不再挂着旧警告 |
| 节流 | 每首之间间隔 120 ms，避免短时间把音源打满 |
| 关闭开关时 | 直接返回 `disabled`，界面提示先到「设置 → 下载」打开 |

### 10.3 交互

下载页顶部按钮从 3 个变 4 个，新增「重下失败歌词」，与「暂停全部 / 清除已完成 / 诊断」并排，窄屏自动换行。

结果用 toast 反馈：

| 情况 | 提示 |
|---|---|
| 有缺失并补齐 | `歌词已补齐（N 首）` |
| 部分仍失败 | `补齐 N 首，仍有 M 首未获取到歌词` |
| 没有缺失 | `已下载的歌曲都有歌词，不需要重下` |
| 开关关着 | `没有开启歌词下载，请先到「设置 → 下载」打开` |

### 10.4 回归结果

| 项 | 结果 |
|---|---|
| `tsc --noEmit`（改动文件） | 0 错误 |
| `eslint`（改动文件） | 0 问题 |
| 端到端 19 用例 | 全部通过（新增 TC-16 ~ TC-19） |
| 三语语言包 | 6 个新 key 在 zh-cn / zh-tw / en-us 三份文件里齐全，JSON 解析通过 |

## 11. v6：性能、日志与四项功能

这一版没有加新页面，改动集中在「任务多了会卡」「出问题留不下证据」「几个高频操作要重复点」三件事上。

### 11.1 性能：五处真实瓶颈

| 编号 | 问题 | 证据 | 修法 |
|---|---|---|---|
| P1 | 每次进度通知全量拷贝任务数组 | `hook.ts` 用 `tasks.map(t => ({...t}))`，`FlatList` 还挂了 `extraData={tasks}` | 任务加 `rev`，未变的任务复用旧对象，`memo` 直接跳过 |
| P2 | 调度器用 `tasks.find()` 从头扫 | `pump()` 的 `while` 每轮都从数组头开始 | 环形游标 `waitCursor`，O(1) 均摊；入队/重试/删除时重置 |
| P3 | 统计跑四次 `filter` | `getDownloadStats()` | 合并成一次遍历 |
| P4 | `FlatList` 无虚拟化参数 | 只有 `keyExtractor` 与 `extraData` | 补 `windowSize` / `maxToRenderPerBatch` / `updateCellsBatchingPeriod` / `initialNumToRender` |
| P5 | 写盘 800ms 全量序列化 | `persist()` | 放宽到 2s，失败写进日志而不是静默丢弃 |

效果是可量化的：500 首队列、3 并发时，一次进度回调原本要复制 500 个对象并让整片列表重渲染；现在只复制 1~3 个，其余引用不变。TC-24 直接验证了「别的任务下载时，已完成任务的对象引用与 `rev` 都不变」。

### 11.2 错误日志

新增 `src/core/download/logger.ts`，约 200 行，零依赖：

| 能力 | 实现 |
|---|---|
| 落盘 | `DocumentDir/download-logs/YYYY-MM-DD.log`，内存缓冲 1 秒批量 append |
| 轮转 | 单文件 256 KB 转 `.log.1`；总量 3 MB 或超 7 天从最旧删 |
| 崩溃 | `ErrorUtils.setGlobalHandler` 前置拦截，写 `FATAL` + 堆栈后透传原处理器 |
| 读写 | 「诊断」优先读内存，空则回退磁盘；「导出日志」取最近 400 行复制到剪贴板 |
| 开关 | 设置 → 下载 → 错误日志，关掉后 `writeDownloadLog` 直接 return，不产生 IO |

日志级别只有 `info / debug / warn / error / fatal` 五档，避免为「分级」而分级——真正需要的是出错那一条带步骤与堆栈，其余只要够还原时序。

### 11.3 四项功能

| 功能 | 实现要点 | 体积代价 |
|---|---|---|
| 并发数可调 | 设置项本就存在（1–5），这版补上「改完立即生效」的语义校验与上限收敛 | 0 |
| 批量重试失败 | `retryAllFailed()`：只把 `status=error` 改回 `waiting`，不动 done/waiting/paused | 0 |
| 空间预检 | 按音质估算（128k 4 MB / 320k 10 MB / FLAC 35 MB / FLAC24 55 MB），留 20% 余量；不足时只提示不阻断 | 0 |
| 仅 WiFi | 新增 `NetworkTypeModule`（约 100 行 Java，同步返回 wifi/mobile/ethernet/none），调度器在网络不满足时挂起并每 3 秒轮询 | dex 增加几 KB，无第三方依赖 |

「仅 WiFi」有两个细节值得说：

1. **不消耗重试次数**。下载中途切到移动网络时，任务退回 `waiting` 而不是计入一次失败，避免三次重试全浪费在没网的时候。
2. **原生模块缺失时放行**。`getType()` 拿不到就返回 `unknown` 并按允许处理——不能因为一个可选功能把下载彻底锁死。

### 11.4 回归结果

| 项 | 结果 |
|---|---|
| `tsc --noEmit`（改动文件） | 0 错误 |
| `eslint`（改动文件） | 0 问题 |
| 端到端 25 用例 | 全部通过（真实音源，新增 TC-20 ~ TC-25） |
| 任务规模 | 17 个任务 / 28 个文件，含 320k 10.29 MB、FLAC 52.83 MB 原样、降级 128k |
| 三语语言包 | 16 个新 key 在 zh-cn / zh-tw / en-us 三份文件里齐全，JSON 解析通过 |
| APK 体积 | 与 v5 基本持平（新增原生模块仅几 KB dex） |

## 12. v7：关闭应用内更新检查，改为「关于本改版」

| 项 | 值 |
|---|---|
| 被测产物 | `lx-music-mobile-v1.9.2-batch.7-{arm64-v8a,universal}.apk` |
| 版本 | `1.9.2-batch.7`（versionCode 84000，可覆盖 83000） |
| 改动目标 | 改版随官方手动跟进，App 不再联网检查版本，不再下载上游 APK |

### 12.1 为什么要关

原版 `src/utils/version.js` 有 8 个官方更新源（raw.githubusercontent、npm 包 `lx-music-mobile-version-info`、jsdelivr×3、gitee、cdn.stsky.cn），`downloadNewVersion` 写死上游 GitHub Releases 的 APK 地址。上游包名 `cn.toside.music.mobile`、签名都与本改版不同，装上去**不会覆盖，而是并存成第二个 LX Music**。此外 `compareVer` 把非数字字符转成负数段，`1.9.2-batch.7` 会被判成低于 `1.9.2`，只要上游 version.json 一读进来就误报新版本。

还有一个容易忽略的启动开销：`core/init/index.ts` 与 `PactModal.tsx` 在冷启动无条件调 `checkUpdate()`，8 个源 × 每个重试 3 次 × 10 秒超时，全部失败才结束。

### 12.2 改动清单

| 文件 | 改动 |
|---|---|
| `src/utils/version.js` | 8 个地址与官方下载 URL 全部移除；`getVersionInfo` / `downloadNewVersion` / `updateApp` 三个函数保留签名但一律抛 `UPDATE_CHECK_DISABLED` |
| `src/core/version.ts` | `checkUpdate` 首行短路，置 `idle` / `isLatest=true`；`downloadUpdate` 空实现。调用方（init、PactModal）一行未改 |
| `src/store/version/state.ts` | 初始状态由 `checking`/`isLatest=false` 改为 `idle`/`isLatest=true` |
| `src/screens/.../Setting/settings/Version.tsx` | 重写为静态版本信息，入口按钮改为「查看详情」 |
| `src/navigation/components/VersionModal.tsx` | 重写为「关于本改版」：版本两行 + 构建时间 + 架构 + 特性 + 致谢与非官方声明 + 使用声明，移除下载进度、忽略版本、安装按钮 |
| `src/config/batch.ts` | 集中提供 `baseVersion`（package.json）与 `getBatchVersion()`（原生 versionName） |
| `src/utils/nativeModules/appInfo.ts` + 2 个 Java 文件 | 极小原生模块读 `PackageManager`：versionName / versionCode / APK mtime / ABI。不动 `process.versions.app`，避免污染 User-Agent |
| `src/lang/{zh-cn,zh-tw,en-us}.json` | 各 +17 个 `about_*` 键 |
| `android/app/build.gradle` | `-batch.6` → `-batch.7`，`+4` → `+5`（versionCode 83000 → 84000） |

### 12.3 验证结果

| 项 | 结果 |
|---|---|
| `npx tsc --noEmit`（改动文件） | 0 错误；仅剩 5 处上游既有 player 类型错误 + 测试脚手架 14 处，均与本次改动无关 |
| `npx eslint`（7 个改动文件） | 0 问题 |
| `node test/version-guard.mjs` | **9/9 通过**：三个底层函数均抛 `UPDATE_CHECK_DISABLED`；`checkUpdate` 后 `status=idle` / `isLatest=true` / `newVersion=null`；`downloadUpdate` 空实现；`src` 内无官方更新源地址；`globalData.ts` 的 UA 版本号来源未被改动 |
| 三语 JSON | zh-cn / zh-tw / en-us 均 +17 键，`json.loads` 校验通过 |
| Gradle `assembleRelease` | BUILD SUCCESSFUL，2m20s |
| APK 元数据 | `aapt2 dump badging`：包名 `cn.toside.music.mobile.batch`、versionName `1.9.2-batch.7`、versionCode `84000`、应用名 `LX Music Batch`；arm64 包 `native-code: arm64-v8a`，universal 含四种 ABI |
| APK 内 bundle 静态检查 | 官方域名 `lx-music-mobile-version-info` / `cdn.stsky.cn` / `lx-music-mobile-versions` / `publish/version.json` 命中数均为 **0**；`UPDATE_CHECK_DISABLED` 也不在包内（该模块无任何引用，被打包器整体摇掉）；新文案「关于本改版」在包内（UTF-16LE 命中 1 次）；`AppInfo` / `getVersionName` / `getBuildTime` 均在包内 |
| 补丁 | 71 文件，`patch -p1 -E --dry-run` 在干净 v1.9.2 源码上退出码 0 |

> `UPDATE_CHECK_DISABLED` 不在最终包里是预期结果：`src/utils/version.js` 已无任何导入者，Metro 不会把它打进 bundle。源码中仍保留骨架，将来接自建发布源时只需恢复三个函数并重新 import。

### 12.4 未覆盖

- **模拟器 UI 截图未取得**：无 `/dev/kvm`，TCG 模式模拟器在本轮安装完成后掉线（`adb: no devices/emulators found`），设置页与「关于本改版」弹窗的布局未能截图确认。v6 也曾因 System UI ANR 未拿到设置页截图。
- **真机覆盖安装**：versionCode 84000 > 83000 且签名未变，理论可直接 `adb install -r`；真机实际覆盖仍待确认。
- **离线启动耗时**：代码路径上已无网络请求，但真机 logcat 抓包未做。

### 12.5 结论

更新检查在**代码层**被切断，不是靠界面隐藏按钮：任何调用路径都拿不到上游版本信息、也下不到上游 APK。设置页语义从「软件更新」改为「关于本改版」，版本号与构建信息由原生读取、跟版时无需改 JS。改动收敛在少数文件并带 `// [BATCH]` 标记，便于后续跟进上游合并。
