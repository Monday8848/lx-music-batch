package cn.toside.music.mobile.network;

import android.content.Context;
import android.net.ConnectivityManager;
import android.net.NetworkCapabilities;
import android.net.NetworkInfo;
import android.os.Build;

import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReactContextBaseJavaModule;
import com.facebook.react.bridge.ReactMethod;

import javax.annotation.Nonnull;

/**
 * 极小的网络类型查询模块，只为「仅 WiFi 下载」服务。
 * 没有引入第三方库，编译后只增加几 KB dex。
 */
public class NetworkTypeModule extends ReactContextBaseJavaModule {
  public static final String NAME = "NetworkType";

  public NetworkTypeModule(ReactApplicationContext context) {
    super(context);
  }

  @Nonnull
  @Override
  public String getName() {
    return NAME;
  }

  private ConnectivityManager getManager() {
    return (ConnectivityManager) getReactApplicationContext()
        .getSystemService(Context.CONNECTIVITY_SERVICE);
  }

  /**
   * 同步返回当前网络类型：wifi / mobile / ethernet / other / none / unknown
   * 同步是刻意的——调度器每一轮都要判断，异步会让调度逻辑变复杂，而这个调用只是读内存状态。
   */
  @ReactMethod(isBlockingSynchronousMethod = true)
  public String getType() {
    try {
      ConnectivityManager cm = getManager();
      if (cm == null) return "unknown";
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
        NetworkCapabilities caps = cm.getNetworkCapabilities(cm.getActiveNetwork());
        if (caps == null) return "none";
        if (caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI)) return "wifi";
        if (caps.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR)) return "mobile";
        if (caps.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET)) return "ethernet";
        return "other";
      }
      NetworkInfo info = cm.getActiveNetworkInfo();
      if (info == null || !info.isConnected()) return "none";
      switch (info.getType()) {
        case ConnectivityManager.TYPE_WIFI:
          return "wifi";
        case ConnectivityManager.TYPE_MOBILE:
          return "mobile";
        case ConnectivityManager.TYPE_ETHERNET:
          return "ethernet";
        default:
          return "other";
      }
    } catch (Throwable e) {
      return "unknown";
    }
  }

  /** 是否为计费网络（热点、按流量计费的 WiFi 也会是 true） */
  @ReactMethod(isBlockingSynchronousMethod = true)
  public boolean isMetered() {
    try {
      ConnectivityManager cm = getManager();
      return cm != null && cm.isActiveNetworkMetered();
    } catch (Throwable e) {
      return false;
    }
  }
}
