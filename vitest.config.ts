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
    include: ['src/**/*.{test,spec}.{ts,tsx}', 'scripts/__tests__/*.test.mjs'],
    exclude: ['node_modules', 'dist', 'e2e/**', 'scripts/__tests__/lint-capabilities.test.mjs'],
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
      // 门禁口径（2026-09-11 重校准：vitest 4 覆盖率口径变化）
      //
      // 历史：2026-09-04 整改后按 vitest 3.2.x 实测 lines 50.6 / funcs 66.8 / branches 78.8，
      // 故阈值定为 48/60/50/48。
      // 变化：2026-09-10 `cc0885a fix(deps): 修复 12 个依赖漏洞` 把 vitest 3.2.7 →
      // 4.1.11、@vitest/coverage-v8 3.2.4 → 4.1.11（vitest <4.1.11 有漏洞且无 3.x 修复版，
      // 不可回退）。vitest 4 的 v8 provider 改为 AST 感知重映射，对「零覆盖模块」的
      // function/branch 计数口径与 3.x 不同 → 同一份代码实测降到
      // lines 46.6 / funcs 43 / branches 38.5 / statements 45.9。
      //
      // 判据（为什么是「口径变化」而不是「质量退化」）：`cb0c3498`（最后绿灯）→
      // `969f786`（首个红灯）之间 **src/ 生产代码零改动**（仅 2 个测试文件适配 vitest 4），
      // 且 163 个测试文件全部通过、无测试被删除 → 覆盖率下降只可能来自度量口径。
      // 因此按新口径重校准（而非回退依赖），并留 ~0.5pp 余量防抖动；阈值仍是「只升不降」
      // 的棘轮——后续覆盖率再降会被重新拦下。
      thresholds: {
        lines: 46,
        functions: 42,
        branches: 38,
        statements: 45,
      },
    },
  },
})
