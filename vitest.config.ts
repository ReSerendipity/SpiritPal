/// <reference types="vitest" />
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import path from 'node:path'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    globals: true,
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    exclude: ['node_modules', 'dist', 'e2e/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      reportsDirectory: './coverage',
      include: ['src/lib/**/*.{ts,tsx}', 'src/components/**/*.{ts,tsx}'],
      exclude: [
        'src/lib/types.ts',
        'src/lib/i18n.ts',
        'src/lib/vectorWorker.ts',
        'src/**/*.d.ts',
        'src/**/__tests__/**',
        'src/**/*.test.{ts,tsx}',
        'src/**/*.spec.{ts,tsx}',
        'src/mobile/**',
        // 重度依赖 Tauri 原生 API 的 UI 组件，需 E2E 测试覆盖
        'src/components/PetWindow.tsx',
        'src/components/SettingsWindow.tsx',
        'src/components/CommunityPanel.tsx',
        'src/components/ModPanel.tsx',
        'src/components/CharacterCreator.tsx',
        'src/components/CharacterCreationWizard.tsx',
        'src/components/SpriteSheetPanel.tsx',
        'src/components/MemoryPanel.tsx',
        'src/components/GifToSpriteTool.tsx',
        'src/components/Live2DRenderer.tsx',
        'src/components/SpriteRenderer.tsx',
        'src/components/QuickControlsPanel.tsx',
        'src/components/AlbumPanel.tsx',
        'src/components/AchievementPanel.tsx',
        'src/components/ShopPanel.tsx',
        'src/components/PersonalityPanel.tsx',
        'src/components/SchedulePanel.tsx',
        'src/components/InventoryPanel.tsx',
        'src/components/DataPanel.tsx',
        'src/components/CharacterSelector.tsx',
        'src/components/LevelUpOverlay.tsx',
        'src/components/PomodoroOverlay.tsx',
        'src/components/PomodoroPanel.tsx',
        'src/components/DecorationLayer.tsx',
        // 重度依赖 Tauri 原生 API 的 lib 模块
        'src/lib/systemControls.ts',
        'src/lib/clipboardManager.ts',
        'src/lib/screenshotManager.ts',
        'src/lib/pushNotificationManager.ts',
        'src/lib/updater.ts',
        'src/lib/spriteSheetTool.ts',
      ],
      // 门禁口径（2026-09-04 整改后实测：lines 50.6 / funcs 66.8 / branches 78.8）
      // 补测安全/AI 模块后整体覆盖提升，lines 由 40 上调至 48、branches 由 40 上调至 50；
      // funcs 保持 60（v8 对零覆盖模块空函数伪影仍存在，不宜设更高）。
      thresholds: {
        lines: 48,
        functions: 60,
        branches: 50,
        statements: 48,
      },
    },
  },
})
