# Add project specific ProGuard rules here.
# You can control the set of applied configuration files using the
# proguardFiles setting in build.gradle.
#
# For more details, see
#   http://developer.android.com/guide/developing/tools/proguard.html

# If your project uses WebView with JS, uncomment the following
# and specify the fully qualified class name to the JavaScript interface
# class:
#-keepclassmembers class fqcn.of.javascript.interface.for.webview {
#   public *;
#}

# Uncomment this to preserve the line number information for
# debugging stack traces.
#-keepattributes SourceFile,LineNumberTable

# If you keep the line number information, uncomment this to
# hide the original source file name.
#-renamesourcefileattribute SourceFile

# ===== SpiritPal 内嵌 MNN 引擎（端侧 ondevice）=====
# SpiritPalOnDevice.kt 的 native 方法由 Rust(.so) 经 JNI 按类名链接，
# 混淆重命名会破坏链接 → 必须 keep。见 ondevice-embed-plan.md §3.3。
-keep class com.alibaba.mnnllm.android.SpiritPalOnDevice { *; }
# MNN 引擎包（vendored，见 §3.2）整体 keep，防其内部反射/序列化被 shrink/重命名破坏。
-keep class com.alibaba.mnnllm.android.** { *; }

# ===== wry 0.55.1 经 JNI 反射调用的 WryActivity / RustWebView 方法 =====
# 这些方法是 wry 的 Rust 侧经 JNI 按名字/签名调用的（如 android_setup() 调
# activity.getId() "()I"）。R8 在 release 中会把“仅反射可达”的方法当作 unused
# 删除，导致真机启动即 SIGABRT/NoSuchMethodError 崩溃。
# wry 自带的 proguard-wry.pro 未被接入本构建（build.gradle 引用了并不存在的
# proguard-tauri.pro），故在此显式 keep。模板来源：wry-0.55.1/src/android/kotlin/proguard-wry.pro
-keep class com.spiritpal.desktop_pet.* {
  native <methods>;
}

-keep class com.spiritpal.desktop_pet.WryActivity {
  public <init>(...);
  void setWebView(com.spiritpal.desktop_pet.RustWebView);
  java.lang.Class getAppClass(...);
  int getId();
  java.lang.String getVersion();
  int startActivity(...);
}

-keep class com.spiritpal.desktop_pet.Ipc {
  public <init>(...);
  @android.webkit.JavascriptInterface public <methods>;
}

-keep class com.spiritpal.desktop_pet.RustWebView {
  public <init>(...);
  void loadUrlMainThread(...);
  void loadHTMLMainThread(...);
  void evalScript(...);
  # ↓ wry 官方 proguard-wry.pro 漏列的两个「仅 JNI 可达」方法（本项目实测在 release
  #   DEX 中确已被 R8 删除）：clearAllBrowsingData() 由 main_pipe.rs:443 调、
  #   getCookies(String) 由 main_pipe.rs:464 调。触发路径为 wry 的
  #   WebViewMessage::ClearAllBrowsingData / ::GetCookies（tauri 侧对应
  #   clear_all_browsing_data() / cookies()）。虽当前功能未走到，但一旦调用即崩，
  #   故一并 keep。见 docs/agents/GOTCHAS.md #122。
  void clearAllBrowsingData();
  java.lang.String getCookies(java.lang.String);
}

-keep class com.spiritpal.desktop_pet.RustWebChromeClient,com.spiritpal.desktop_pet.RustWebViewClient {
  public <init>(...);
}

# ===== Tauri TauriActivity.getPluginManager()（JNI 调用，必须 keep）=====
# tauri 的 Rust 侧（tauri-2.11.5/src/plugin/mobile.rs、src/manager/webview.rs）
# 以 JNI 名字 "getPluginManager" + 签名 "()Lapp/tauri/plugin/PluginManager;"
# 调用 activity 上的该方法（声明在生成的 TauriActivity 里，MainActivity 继承）。
# R8 看不到任何 Java/Kotlin 调用者 → release 会把整方法当 unused 删除
# → 真机启动即 java.lang.NoSuchMethodError（与上面的 wry getId() 同类故障）。
# 官方规则本应由 tauri CLI 自动生成到 app/proguard-tauri.pro；本仓该文件曾缺失，
# 故在此再显式补一份（该文件为 user-owned、始终被引用、不被 tauri CLI 覆盖），
# 防止自动生成文件再次丢失后复发。见 docs/agents/GOTCHAS.md #122。
-keep class com.spiritpal.desktop_pet.TauriActivity {
  public app.tauri.plugin.PluginManager getPluginManager();
}