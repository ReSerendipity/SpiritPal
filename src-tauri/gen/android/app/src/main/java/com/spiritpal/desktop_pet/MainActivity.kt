package com.spiritpal.desktop_pet

import android.os.Bundle
import android.view.View
import androidx.activity.enableEdgeToEdge
import androidx.core.graphics.Insets
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat

class MainActivity : TauriActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
    // Edge-to-edge 下 WebView 内容会顶进系统状态栏（时间/电量遮挡应用标题）。
    // 将 systemBars insets 转为根容器 padding；仅消费 systemBars，
    // IME 等 insets 继续下发给 WebView，键盘行为不受影响。
    val contentView = findViewById<View>(android.R.id.content)
    ViewCompat.setOnApplyWindowInsetsListener(contentView) { view, windowInsets ->
      val bars = windowInsets.getInsets(WindowInsetsCompat.Type.systemBars())
      view.setPadding(bars.left, bars.top, bars.right, bars.bottom)
      WindowInsetsCompat.Builder(windowInsets)
        .setInsets(WindowInsetsCompat.Type.systemBars(), Insets.NONE)
        .build()
    }
  }
}
