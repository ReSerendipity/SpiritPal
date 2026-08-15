import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'node:path'

/** Remove crossorigin attributes that cause module loading failures in Tauri's custom protocol */
function stripCrossorigin(): Plugin {
  return {
    name: 'strip-crossorigin',
    enforce: 'post',
    transformIndexHtml(html) {
      return html.replace(/ crossorigin/g, '')
    },
  }
}

export default defineConfig({
  plugins: [react(), tailwindcss(), stripCrossorigin()],
  resolve: { alias: { '@': path.resolve(__dirname, './src') } },
  base: './',
  clearScreen: false,
  server: {
    port: 5223,
    strictPort: true,
    host: '127.0.0.1',
  },
  envPrefix: ['VITE_', 'TAURI_'],
  // SECURITY R-08: 生产构建剥离 console 日志，防止元信息泄露
  esbuild: {
    drop: !process.env.TAURI_ENV_DEBUG ? ['console', 'debugger'] : [],
  },
  build: {
    // Windows WebView2 (Chromium) 目标，参考 CodeWalkers 优化
    target: process.env.TAURI_ENV_PLATFORM === 'windows' ? 'chrome105' : 'es2022',
    minify: !process.env.TAURI_ENV_DEBUG ? 'esbuild' : false,
    sourcemap: !!process.env.TAURI_ENV_DEBUG,
    rollupOptions: {
      output: {
        // 参考 CodeWalkers manualChunks 策略：优化缓存利用率
        manualChunks(id) {
          // 核心框架：React + Zustand + Markdown（很少变化，长期缓存）
          // markdown 依赖 react，必须放在同一 chunk 避免 Rolldown 交叉依赖
          if (id.includes('node_modules/react') || id.includes('node_modules/react-dom') || id.includes('node_modules/zustand') || id.includes('node_modules/react-markdown') || id.includes('node_modules/remark') || id.includes('node_modules/rehype')) {
            return 'vendor-react'
          }
          // Tauri API（稳定，几乎不变）
          if (id.includes('node_modules/@tauri-apps')) {
            return 'vendor-tauri'
          }
          // PixiJS 渲染引擎（体积大，不常更新）
          if (id.includes('node_modules/pixi.js')) {
            return 'vendor-pixi'
          }
          // pixi-live2d-display 独立 chunk — 避免 Cubism Core 缺失时拖垮整个应用
          // Live2DRenderer 通过 dynamic import 按需加载，Core 不可用时自动 fallback
          if (id.includes('node_modules/pixi-live2d-display')) {
            return 'vendor-live2d'
          }
          // AI/ML 相关（@xenova/transformers 体积大）
          if (id.includes('node_modules/@xenova/transformers')) {
            return 'vendor-ai'
          }
          // MCP 协议
          if (id.includes('node_modules/@modelcontextprotocol')) {
            return 'vendor-mcp'
          }
          // UI 工具库
          if (id.includes('node_modules/lucide-react')) {
            return 'vendor-ui'
          }
          // i18n
          if (id.includes('node_modules/i18next') || id.includes('node_modules/react-i18next')) {
            return 'vendor-i18n'
          }
        },
      },
    },
  },
})
