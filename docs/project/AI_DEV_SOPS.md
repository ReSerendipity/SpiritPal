<!-- 注记：本节内容于 2026-08-27（家族规范治理 Phase E3）自 AGENTS.md 整节逐字移出，一个字符未改；此后新 SOP 按铁律 #3 直接追加到本文件末尾 -->
# 典型 AI 开发场景 SOP（自 AGENTS.md 移出）

## 13. 典型 AI 开发场景 SOP（照着做，少踩坑）

<!-- 📥 新SOP追加模板（AI 完成新类型任务后复制填好追加到这里）：
#### SOP-X: [场景名称]
**适用条件**：什么情况下走这个流程
**步骤**：
1. 第一步...
2. 第二步...
3. 第三步...
**验证**：怎么确认操作成功
**关联文件**：
- path/to/file1.ts
- path/to/file2.rs
-->

#### SOP-1: 新增一个 Rust Tauri Command（如 `cmd_pet_hug` 撸猫加好感度）
**适用条件**：前端需要访问 Rust 端才能做的操作（加密写库、改系统托盘、写文件）

**步骤**：
1. `src-tauri/src/types.rs` 加入参 + 出参 struct：
   ```rust
   #[derive(Debug, Serialize, Deserialize)]
   pub struct HugResult { pub mood_delta: i32, pub new_total: i32 }
   ```
2. `src-tauri/src/commands/pet.rs` 写函数：
   ```rust
   #[tauri::command]
   pub async fn cmd_pet_hug(app: tauri::AppHandle, pet_id: &str, strength: u8) -> Result<HugResult, String> {
       // 1. 参数校验（strength 1-10，越界 Err("strength out of range")）
       // 2. DB 事务：读 pet → 加好感度 → 写回
       // 3. 发事件给前端（可选） app.emit("spiritpal:mood_changed", ...)
       // 4. Ok(HugResult { mood_delta, new_total })
   }
   ```
3. `src-tauri/src/lib.rs` 的 `Builder::default().invoke_handler(tauri::generate_handler![...])` 里 **把新函数名加进去**（不加的话前端 invoke 会报「command not found」，调试半小时的经典坑）
4. 前端 `src/lib/ipcTypes.ts` 加常量 + 类型：
   ```ts
   export const CMD_PET_HUG = "spiritpal:pet_hug" as const
   export interface HugResult { mood_delta: number; new_total: number }
   ```
5. `src/stores/petStore.ts` 加 action `async hugPet(petId, strength)`，内部调用 `useTauriInvoke<HugResult>(CMD_PET_HUG, { pet_id: petId, strength })`
6. 单元测试：前端 Vitest mock tauri invoker 测 store action；Rust `cargo test cmd_pet_hug_*` 测参数校验和 DB 写入
7. **最后一步**（见 §7.1 Build After Code Changes）：`pnpm build` → 产物复制到 `artifacts/` → 手动点一下验证「撸猫」按钮真的加了好感度。

#### SOP-2: 新增一个 Zustand Store（如新增 achievementStore：成就系统）
1. 新建 `src/stores/achievementStore.ts`：
   ```ts
   import { create } from "zustand"
   import { persist, createJSONStorage } from "zustand/middleware"
   // 注意：如果是敏感数据（用户成就其实无所谓，示例示范加密）
   // import { encryptMiddleware } from "@/lib/encryption/storeMiddleware"

   interface AchievementState {
     unlocked: Record<string, { unlockedAt: number; count?: number }>
     unlock: (id: string) => void
     reset: () => void
   }

   export const useAchievementStore = create<AchievementState>()(
     persist(
       (set) => ({
         unlocked: {},
         unlock: (id) => set((s) => ({ unlocked: { ...s.unlocked, [id]: { unlockedAt: Date.now() } } })),
         reset: () => set({ unlocked: {} })
       }),
       {
         name: "spiritpal:achievements",  // persist 命名统一前缀 spiritpal:xxx
         storage: createJSONStorage(() => localStorage), // 敏感的话换成加密 storage
         partialize: (s) => ({ unlocked: s.unlocked })  // 只持久化需要的字段
       }
     )
   )
   ```
2. `src/lib/types.ts` 加 `AchievementDef` / `UnlockedAchievement` 类型定义（同步改 `src-tauri/src/types.rs` 如果 Rust 端也要读）
3. Vitest 测试：4 个最小用例（初始空、unlock 加、重复 unlock 幂等、reset 清空）
4. 如果 store 里字段要参与 Rust 端 backup/restore 流程 → 同步改 `commands/backup.rs` 的 schema。

#### SOP-3: 新增一个宠物角色（例如新增 Miko 小狐狸 Live2D 模型）

> ⚠️ 前置条件：本仓库不内置 Live2D 模型资产。需自行放置 `public/assets/live2d/<model>/<model>.model3.json`，否则本步骤无法执行。

1. 把新的 Live2D 模型文件（`.model3.json` + `.moc3` + 贴图 + 动作 motion3.json）放到 `public/assets/live2d/<model>/` 目录（例：`miko`）
2. `src/lib/types.ts` 的 `PetSpecies` enum 加 `miko: "fox"` 变体（同步 Rust `types.rs`）
3. `src/stores/petStore.ts` 初始化 `availablePets` 数组里加一条 `{ id: "miko-001", species: "fox", name: "Miko", modelPath: "/assets/live2d/<model>/<model>.model3.json" }`（路径与步骤 1 实际放置的模型目录一致）
4. `src/lib/petBehaviorEngine.ts` 的 FSM 表里加一条 fox 物种的专属动作映射（fox 兴奋时触发 `motion("jump")` 而不是 `motion("wag_tail")`，dog 才 wag tail）
5. **测试**：pnpm dev → 启动后设置里选 Miko → 手动验证：Idle 动画循环正常、点她触发 tap motion、表情切换正常（happy/sad）
6. 性能验证：打开「性能统计面板」(devtools)，确保 Miko FPS 稳定 30 且 30 分钟不泄漏内存（`pnpm test:perf` 单独跑）
7. 翻译补充：每种语言的 `pet_window.default_name_miko` key 补上（「Miko / 美子 / ミコ」等）→ 跑 `pnpm i18n:check`

#### SOP-4: 新增一项设置
1. `src/lib/types.ts` 的 `Settings` interface 加字段（例：`pet_autostart_on_login: boolean` = 开机自启开关）
2. Rust 端 `src-tauri/src/types.rs` 的 Settings struct 同步加
3. `src/stores/settingsStore.ts` 的 default 初始值 + 加 `setPetAutostartOnLogin(v: boolean)` action
4. 前端 `components/settings/GeneralSettings.tsx` 加 UI（Switch / Dropdown），UI 必须走 SpiritPal UI Kit（`BrandSwitch` 组件，不许原生 `<input type=checkbox>`）
5. **如果涉及 OS 能力**（如开机自启 = 写 Windows Registry / macOS LaunchAgents）→ 同步写一个 Rust command `cmd_settings_set_autostart(enabled: bool)`，action 内部调这个 command 而不是直接 localStorage
6. 备份/恢复：`commands/backup.rs` 的 settings 字段加新字段名，不然用户导出 JSON 再导入新字段就丢了
7. 翻译：每种语言 `settings.autostart_label` + `settings.autostart_hint` 补上 → `pnpm i18n:check`
