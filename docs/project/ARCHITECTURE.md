# SpiritPal Monorepo 架构文档

## 1. 项目结构概述

SpiritPal 采用 pnpm workspace monorepo 架构，实现桌面端和移动端的物理隔离与并行开发。

```
spiritpal-app/
├── apps/
│   ├── desktop/          # 桌面端应用 (Tauri + React)
│   │   ├── src/
│   │   │   ├── components/  # 桌面端特有组件 (30+窗口组件)
│   │   │   ├── lib/        # 桌面端特有功能(多窗口、系统托盘等)
│   │   │   ├── App.tsx
│   │   │   └── main.tsx
│   │   ├── src-tauri/    # Rust后端代码
│   │   ├── public/       # 桌面端静态资源
│   │   ├── e2e/          # E2E测试 (Playwright)
│   │   └── perf/         # 性能测试脚本
│   │
│   └── mobile/           # 移动端应用 (Tauri Android/iOS)
│       ├── src/
│       │   ├── views/      # 移动端视图
│       │   ├── components/ # 移动端特有组件
│       │   ├── MobileApp.tsx
│       │   └── main.tsx
│       └── public/       # 移动端静态资源
│
├── packages/
│   ├── shared/           # 共享业务逻辑包
│   │   └── src/
│   │       ├── lib/        # 核心业务逻辑(AI、养成、记忆、Mod等100+模块)
│   │       ├── stores/     # Zustand状态管理
│   │       ├── types/      # TypeScript类型定义
│   │       └── i18n/       # 国际化
│   │
│   ├── ui/               # 共享UI组件包
│   │   └── src/
│   │       ├── Live2DRenderer.tsx
│   │       ├── SpriteRenderer.tsx
│   │       └── PetBubble.tsx
│   │
│   └── config/           # 共享配置包
│       ├── eslint/
│       ├── typescript/
│       └── tailwind/
│
├── package.json          # 根package.json (monorepo脚本)
├── pnpm-workspace.yaml   # pnpm workspace配置
└── tsconfig.json
```

## 2. 开发流程

### 桌面端开发
```bash
# 进入桌面端目录
cd apps/desktop

# 安装依赖(在根目录执行)
pnpm install

# 开发模式
pnpm dev:desktop
# 或 pnpm tauri:dev

# 构建
pnpm build:desktop
# 或 pnpm tauri:build

# Android构建
pnpm android:build
```

### 移动端开发
```bash
# 开发模式
pnpm dev:mobile

# 构建
pnpm build:mobile
```

### 共享模块开发
共享模块位于 `packages/shared/`，修改后会自动热更新到桌面端和移动端。

## 3. 共享资源使用方式

### 导入共享业务逻辑
```typescript
// 从共享包导入
import { usePetStore, behaviorEngine, aiAgent } from '@spiritpal/shared'
import type { CharacterProfile, NurturingStats } from '@spiritpal/shared/types'
import { useTranslation } from '@spiritpal/shared/i18n'
```

### 导入共享UI组件
```typescript
import { Live2DRenderer, SpriteRenderer, PetBubble } from '@spiritpal/ui'
```

## 4. Git分支策略

- `main` - 主分支，保护分支，仅通过PR合并
- `develop` - 开发集成分支
- `feature/desktop/*` - 桌面端功能分支
- `feature/mobile/*` - 移动端功能分支
- `feature/shared/*` - 共享模块功能分支
- `fix/desktop/*` - 桌面端修复分支
- `fix/mobile/*` - 移动端修复分支
- `release/*` - 发布分支

### 合并流程
1. 功能分支从develop创建
2. 开发完成后提交PR到develop
3. CI通过后代码审查
4. 合并到develop
5. 发布时从release合并到main

## 5. 测试隔离

### 桌面端测试
- 单元测试: `pnpm test:desktop` (Vitest)
- E2E测试: `pnpm test:e2e` (Playwright, 端口5223)
- 覆盖率: `pnpm test:desktop --coverage`

### 移动端测试
- 单元测试: `pnpm test:mobile` (Vitest, 端口5224)
- 覆盖率: `pnpm test:mobile --coverage`

### 共享模块测试
- 单元测试: `pnpm test:shared`

## 6. 构建与部署

### 桌面端构建产物
- Windows: NSIS安装包
- macOS: DMG镜像
- Linux: AppImage/Deb包

### 移动端构建产物
- Android: APK/AAB
- iOS: IPA (需macOS)

## 7. 代码规范

- TypeScript严格模式
- ESLint代码检查
- Prettier代码格式化
- Conventional Commits提交规范
- 路径别名: @/ 表示当前包src目录，@spiritpal/ 表示共享包
