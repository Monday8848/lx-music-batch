package cn.toside.music.mobile.appinfo;

import android.content.pm.PackageInfo;
import android.os.Build;

import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReactContextBaseJavaModule;
import com.facebook.react.bridge.ReactMethod;

import java.io.File;

import javax.annotation.Nonnull;

/**
 * 读取安装包自身的版本信息，只服务于「关于本改版」页面。
 *
 * 刻意不走 BuildConfig 注入：直接用 PackageManager 读，版本号天然与
 * android/app/build.gradle 的 versionName 一致，不会出现「gradle 改了、JS 没改」的不同步。
 *
 * 也刻意不去改 process.versions.app —— 那个值被 src/utils/request.js 拿去拼 User-Agent，
 * 带上 -batch.N 后缀有被音源服务端判为异常 UA 的风险，保持原样。
 */
public class AppInfoModule extends ReactContextBaseJavaModule {
  public static final String NAME = "AppInfo";

  public AppInfoModule(ReactApplicationContext context) {
    super(context);
  }

  @Nonnull
  @Override
  public String getName() {
    return NAME;
  }

  private PackageInfo getPackageInfo() {
    try {
      ReactApplicationContext context = getReactApplicationContext();
      return context.getPackageManager().getPackageInfo(context.getPackageName(), 0);
    } catch (Throwable e) {
      return null;
    }
  }

  /** 版本名，形如 1.9.2-batch.7 */
  @ReactMethod(isBlockingSynchronousMethod = true)
  public String getVersionName() {
    PackageInfo info = getPackageInfo();
    return info == null || info.versionName == null ? "" : info.versionName;
  }

  /** 版本号（整数），对应 build.gradle 里 * 1000 之后的 versionCode */
  @ReactMethod(isBlockingSynchronousMethod = true)
  public double getVersionCode() {
    PackageInfo info = getPackageInfo();
    if (info == null) return 0;
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) return info.getLongVersionCode();
    return info.versionCode;
  }

  /** 安装包构建时间（APK 文件的修改时间，毫秒时间戳），读不到返回 0 */
  @ReactMethod(isBlockingSynchronousMethod = true)
  public double getBuildTime() {
    try {
      File apk = new File(getReactApplicationContext().getApplicationInfo().sourceDir);
      return apk.exists() ? apk.lastModified() : 0;
    } catch (Throwable e) {
      return 0;
    }
  }

  /** 当前设备首选 ABI，形如 arm64-v8a，用于排查装错架构的闪退 */
  @ReactMethod(isBlockingSynchronousMethod = true)
  public String getAbi() {
    try {
      String[] abis = Build.SUPPORTED_ABIS;
      return abis != null && abis.length > 0 ? abis[0] : "";
    } catch (Throwable e) {
      return "";
    }
  }
}
