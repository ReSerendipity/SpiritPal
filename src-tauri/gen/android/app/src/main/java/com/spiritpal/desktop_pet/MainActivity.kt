package com.spiritpal.desktop_pet

import android.os.Bundle
import android.view.View
import androidx.activity.enableEdgeToEdge
import androidx.activity.OnBackPressedCallback
import androidx.core.graphics.Insets
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import com.alibaba.mnnllm.android.SpiritPalOnDevice

class MainActivity : TauriActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
    // Edge-to-edge 下 WebView 内容会顶进系统状态栏（时间/电量遮挡应用标题）。
    // 将 systemBars insets 转为根容器 padding。
    //
    // D-IME 修复：底部 padding 取 systemBars 与 ime 的较大值，并且把 ime 也消费掉。
    // 原先只消费 systemBars、让 ime 继续下发给 WebView，注释据此断言"键盘行为不受
    // 影响"——该断言不成立：edge-to-edge 下窗口不再随 IME resize，WebView 也拿不到
    // IME 可视区变化，`visualViewport.height` 保持不动，聊天页的输入行与发送按钮
    // 被键盘整个盖住（用户在收起键盘前看不到自己输入的内容）。
    // 两处实测证据：realme/Android 16/ColorOS 与本仓 Android 15 模拟器 x86_64 均复现，
    // 说明这是通用缺陷而非 OEM 特有。ime 一并消费是必须的：否则 WebView 会在我们
    // 已经加过 padding 之后再收一次底部内边距，键盘弹出时内容被压缩两遍。
    val contentView = findViewById<View>(android.R.id.content)
    ViewCompat.setOnApplyWindowInsetsListener(contentView) { view, windowInsets ->
      val bars = windowInsets.getInsets(WindowInsetsCompat.Type.systemBars())
      val ime = windowInsets.getInsets(WindowInsetsCompat.Type.ime())
      view.setPadding(
        bars.left,
        bars.top,
        bars.right,
        maxOf(bars.bottom, ime.bottom),
      )
      WindowInsetsCompat.Builder(windowInsets)
        .setInsets(WindowInsetsCompat.Type.systemBars(), Insets.NONE)
        .setInsets(WindowInsetsCompat.Type.ime(), Insets.NONE)
        .build()
    }

    // 退出 SIGABRT 修复：TauriActivity.handleBackNavigation=false，返回键走系统默认
    // 直接 finish Activity → WebView 销毁后仍有事件投递触发 wry 断言崩溃
    // （"no available activity"）。桌宠语义下返回键应「退到后台」而非销毁进程，
    // 故拦截返回键改为 moveTaskToBack，根除该崩溃。
    onBackPressedDispatcher.addCallback(
      this,
      object : OnBackPressedCallback(true) {
        override fun handleOnBackPressed() {
          moveTaskToBack(true)
        }
      },
    )

    // P1-D：把外部专属模型目录（getExternalFilesDir，框架 provision、adb push 可写）
    // 回传给 Rust 端侧引擎，修正「裸路径创建被 FUSE/SELinux 拒 → 回退私有目录 →
    // 用户无法经 adb 放入模型」。引用 Rust 触发其 init（System.loadLibrary）。
    try {
      Rust
      getExternalFilesDir("models")?.absolutePath?.let {
        SpiritPalOnDevice.nativeSetExternalModelsDir(it)
      }
    } catch (_: Throwable) {
      // 库未就绪/异常时静默：Rust 侧 model_dir() 回退原逻辑
    }
  }
}
