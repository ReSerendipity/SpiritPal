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