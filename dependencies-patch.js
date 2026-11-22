// 修补依赖源码以使构建的依赖恢复正常工作

const fs = require('node:fs')
const path = require('node:path')

const rootPath = path.join(__dirname, './')

const patchs = [
  // 扩展标签写入字段：音轨号 / 年份 / 流派
  [
    path.join(rootPath, 'node_modules/react-native-local-media-metadata/android/src/main/java/com/localmediametadata/Metadata.java'),
    '    tag.setField(FieldKey.ALBUM, metadata.getString("albumName", ""));\n    audioFile.commit();',
    `    tag.setField(FieldKey.ALBUM, metadata.getString("albumName", ""));
    if (metadata.containsKey("trackNumber")) {
      String trackNumber = metadata.getString("trackNumber", "");
      if (trackNumber != null && !trackNumber.isEmpty()) tag.setField(FieldKey.TRACK, trackNumber);
    }
    if (metadata.containsKey("year")) {
      String year = metadata.getString("year", "");
      if (year != null && !year.isEmpty()) tag.setField(FieldKey.YEAR, year);
    }
    if (metadata.containsKey("genre")) {
      String genre = metadata.getString("genre", "");
      if (genre != null && !genre.isEmpty()) tag.setField(FieldKey.GENRE, genre);
    }
    audioFile.commit();`,
  ],
  // 新增媒体库扫描能力
  [
    path.join(rootPath, 'node_modules/react-native-local-media-metadata/android/src/main/java/com/localmediametadata/LocalMediaMetadataModule.java'),
    'import androidx.annotation.NonNull;',
    'import android.media.MediaScannerConnection;\n\nimport androidx.annotation.NonNull;',
  ],
  [
    path.join(rootPath, 'node_modules/react-native-local-media-metadata/android/src/main/java/com/localmediametadata/LocalMediaMetadataModule.java'),
    '  public void writeLyric(String filePath, String lyric, Promise promise) {\n    AsyncTask.runTask(new MetadataCallable.WriteLyric(reactContext, filePath, lyric), promise);\n  }\n}',
    `  public void writeLyric(String filePath, String lyric, Promise promise) {
    AsyncTask.runTask(new MetadataCallable.WriteLyric(reactContext, filePath, lyric), promise);
  }

  /**
   * 通知系统媒体库扫描文件，让新文件立即出现在系统音乐 App 中
   */
  @ReactMethod
  public void scanFile(String filePath, Promise promise) {
    try {
      MediaScannerConnection.scanFile(reactContext, new String[]{filePath}, null,
        (path, uri) -> promise.resolve(uri != null ? uri.toString() : ""));
    } catch (Exception err) {
      promise.reject("SCAN_FAILED", err);
    }
  }
}`,
  ],
]

;(async() => {
  for (const [filePath, fromStr, toStr] of patchs) {
    console.log(`Patching ${filePath.replace(rootPath, '')}`)
    try {
      const file = (await fs.promises.readFile(filePath)).toString()
      await fs.promises.writeFile(filePath, file.replace(fromStr, toStr))
    } catch (err) {
      console.error(`Patch ${filePath.replace(rootPath, '')} failed: ${err.message}`)
    }
  }

  // @craftzdog/react-native-buffer 依赖 quick-base64 ^3，会被装成嵌套的 v3：
  // v3 的 JS 走 TurboModule 的 base64ToArrayBuffer，而原生只链接了 v2（只有 JSI install 方法），
  // 任何 base64 运算都会抛 "undefined is not a function"。删掉嵌套版本让它复用顶层的 v2。
  const nestedQuickBase64 = path.join(rootPath, 'node_modules/@craftzdog/react-native-buffer/node_modules/react-native-quick-base64')
  try {
    if (fs.existsSync(nestedQuickBase64)) {
      console.log('Removing nested react-native-quick-base64 (v3) ...')
      fs.rmSync(nestedQuickBase64, { recursive: true, force: true })
    }
  } catch (err) {
    console.error(`Remove nested react-native-quick-base64 failed: ${err.message}`)
  }

  console.log('\nDependencies patch finished.\n')
})()

