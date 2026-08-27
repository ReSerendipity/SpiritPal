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
      'no-empty': ['error', { allowEmptyCatch: true }],
      'import/order': ['warn', {
        groups: [
          'builtin',       // Node.js / Tauri 官方
          'external',      // 第三方库
          'internal',      // 本地项目 (@/ 别名)
          'parent',        // 相对路径上级
          'sibling',       // 相对路径同级
          'index',         // 同目录 index
          'type',          // type-only imports
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
      }],
    },
  },
)
