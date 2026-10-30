// Copyright 2019-2024 Tauri Programme within The Commons Conservancy
// SPDX-License-Identifier: Apache-2.0
// SPDX-License-Identifier: MIT

/* THIS FILE IS AUTO-GENERATED. DO NOT MODIFY!! */
// 2026-10-30 手工同步：按 tauri 2.12.5 的 mobile/android-codegen/TauriActivity.kt 模板重写。
// 2.12.5 移除了 ProcessLifecycleOwner 观察者（生命周期改由 wry 0.57 自身处理），
// PluginManager 的生命周期方法也从 onActivityCreate() 改为 onCreate(activity)。
// 下次用 @tauri-apps/cli 2.12.x 重新生成时会得到同样内容。

package com.spiritpal.desktop_pet

import android.content.Intent
import android.content.res.Configuration
import android.os.Bundle
import app.tauri.plugin.PluginManager

abstract class TauriActivity : WryActivity() {
  override val handleBackNavigation: Boolean = false

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    PluginManager.onCreate(this)
  }

  fun getPluginManager(): PluginManager {
    return PluginManager
  }

  override fun onNewIntent(intent: Intent) {
    super.onNewIntent(intent)
    PluginManager.onNewIntent(intent)
  }

  override fun onRestart() {
    super.onRestart()
    PluginManager.onRestart(this)
  }

  override fun onResume() {
    super.onResume()
    PluginManager.onResume(this)
  }

  override fun onPause() {
    super.onPause()
    PluginManager.onPause(this)
  }

  override fun onStop() {
    super.onStop()
    PluginManager.onStop(this)
  }

  override fun onDestroy() {
    super.onDestroy()
    PluginManager.onDestroy(this)
  }

  override fun onConfigurationChanged(newConfig: Configuration) {
    super.onConfigurationChanged(newConfig)
    PluginManager.onConfigurationChanged(newConfig)
  }
}
