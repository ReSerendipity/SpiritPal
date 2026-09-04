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

`\ntests/e2e/\n├── setup/\n│   └── tauri-helper.ts      # Tauri 应用交互工具\n├── app-loading.spec.ts       # 应用加载流程\n├── pet-interaction.spec.ts   # 宠物交互功能\n├── memory-system.spec.ts     # 记忆系统\n├── inventory-system.spec.ts  # 背包/商店系统\n├── accessibility.spec.ts     # 可访问性\n└── README.md\n`\n+

## 添加新测试

1. 在 `tests/e2e/` 目录下创建 `.spec.ts` 文件
2. 导入必要的 helper：`import { waitForSpiritPalApp } from './setup/tauri-helper';`
3. 使用标准的 Playwright 测试语法
4. 对于需要与 Live2D 宠物交互的测试，使用提供的辅助函数

## 环境变量

* `CI=true`: CI 环境下禁用并行、增加重试次数

* `PLAYWRIGHT_BASE_URL`: 自定义测试基础 URL（默认 <http://localhost:5173）>

## 故障排查

* 如果测试超时，增加对应测试的 `timeout` 参数

* 如果找不到元素，检查前端代码中的 `data-testid` 属性是否匹配\n- 截图和视频保存在 `test-results/screenshots/` 目录

## E2E 目录分工（2026-09-04 定稿）

> 历史遗留：`e2e/` 顶层曾有一批旧 spec 与 Tauri IPC mock（`e2e/fixtures/tauri-mock.ts`），
> 但 `playwright.config.ts` 的 `testDir` 早已指向 `tests/e2e`，旧目录无任何配置引用，
> 已按审计整改清理（P1-3），仅保留桌面真机层。

| 目录                  | 配置                                                          | 定位                                                          | 何时跑                                                                          |
| ------------------- | ----------------------------------------------------------- | ----------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `tests/e2e/`（本目录）   | `playwright.config.ts`（`testDir: ./tests/e2e`）              | **Web E2E**：vite dev server + Playwright，纯浏览器环境（无 Tauri 后端） | CI 必跑（`pnpm test:e2e`）                                                       |
| `e2e/tauri-driver/` | `playwright.tauri.config.ts`（`testDir: ./e2e/tauri-driver`） | **桌面真机 E2E**：tauri-driver + WebDriverIO 连接真实构建产物            | 仅本地手动（需 `pnpm tauri build` + `tauri-driver`），CI 通过 `TAURI_DRIVER_ENABLED` 跳过 |

* **新增 Web E2E** → 放本目录，遵循上方「添加新测试」约定。

* **新增桌面真机用例** → 放 `e2e/tauri-driver/`，参考该目录 spec 头注释的前置条件。

* 两层各自独立，互不干扰；`tests/e2e/setup/tauri-helper.ts` 是真实应用等待助手（非 IPC mock），
  若未来需要「带 Tauri API 的 Web E2E」，将 mock 放回 `tests/e2e/setup/` 单独维护。

