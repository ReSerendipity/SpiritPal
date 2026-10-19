import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import importPlugin from 'eslint-plugin-import'

export default tseslint.config(
  { ignores: ['dist', 'src-tauri', 'node_modules', 'perf', 'e2e', 'test-results'] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      globals: {
        browser: true,
        node: true,
      },
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
      import: importPlugin,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/ban-ts-comment': 'warn',
      // 2026-10-16：收紧 allowEmptyCatch（对应报告「吞没异常」P1）——空 catch 一律报错，
      // 确需忽略时必须显式记录上下文（参考 src/lib/system/swallowedCatch.ts）
      'no-empty': ['error', { allowEmptyCatch: false }],
      // 禁用 React Compiler 严格规则（与现有代码模式不兼容）
      'react-hooks/refs': 'off',
      'react-hooks/set-state-in-effect': 'off',
      'react-hooks/globals': 'off',
      'react-hooks/preserve-manual-memoization': 'off',
      'react-hooks/immutability': 'off',
      'react-hooks/no-access-of-unmounted-ref-in-render': 'off',
      'import/order': [
        'warn',
        {
          groups: [
            'builtin', // Node.js / Tauri 官方
            'external', // 第三方库
            'internal', // 本地项目 (@/ 别名)
            'parent', // 相对路径上级
            'sibling', // 相对路径同级
            'index', // 同目录 index
            'type', // type-only imports
          ],
          pathGroups: [
            { pattern: 'react', group: 'builtin' },
            { pattern: 'react-dom', group: 'builtin' },
            { pattern: '@tauri-apps/**', group: 'builtin' },
            { pattern: '@/**', group: 'internal' },
          ],
          pathGroupsExcludedImportTypes: ['react'],
          'newlines-between': 'never',
          alphabetize: { order: 'asc', caseInsensitive: true },
        },
      ],
    },
  },
)
