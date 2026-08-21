# E2E 测试套件说明

## 运行测试

```bash
# 首次运行需安装 Playwright 浏览器
npx playwright install

# 运行所有 E2E 测试
pnpm test:e2e

# 查看 HTML 报告
pnpm exec playwright show-report test-results/report

# 以调试模式运行（带 UI）
npx playwright test --ui

# 生成视频和截图（失败时）
# 已在配置中自动启用
```

## 测试结构

```\ntests/e2e/\n├── setup/\n│   └── tauri-helper.ts      # Tauri 应用交互工具\n├── app-loading.spec.ts       # 应用加载流程\n├── pet-interaction.spec.ts   # 宠物交互功能\n├── memory-system.spec.ts     # 记忆系统\n├── inventory-system.spec.ts  # 背包/商店系统\n├── accessibility.spec.ts     # 可访问性\n└── README.md\n```\n+
## 添加新测试

1. 在 `tests/e2e/` 目录下创建 `.spec.ts` 文件
2. 导入必要的 helper：`import { waitForSpiritPalApp } from './setup/tauri-helper';`
3. 使用标准的 Playwright 测试语法
4. 对于需要与 Live2D 宠物交互的测试，使用提供的辅助函数

## 环境变量

- `CI=true`: CI 环境下禁用并行、增加重试次数
- `PLAYWRIGHT_BASE_URL`: 自定义测试基础 URL（默认 http://localhost:5173）

## 故障排查

- 如果测试超时，增加对应测试的 `timeout` 参数
- 如果找不到元素，检查前端代码中的 `data-testid` 属性是否匹配\n- 截图和视频保存在 `test-results/screenshots/` 目录
