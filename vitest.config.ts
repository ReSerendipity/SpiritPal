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
    exclude: ['node_modules', 'dist', 'src/mobile/**', 'e2e/**'],
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
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 75,
        statements: 80,
      },
    },
  },
})
