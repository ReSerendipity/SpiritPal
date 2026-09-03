**ADR-0003: 记忆系统选型（cognee vs memvid）**

- **状态**: Proposed（PoC 门控，待验证后转 Implemented）
- **日期**: 2026-09-03
- **决策者**: 项目维护者 + AI 指挥（家族规范审计 / §4.5 任务 #4）
- **关联**: `docs/repo-analysis/BongoCat_技术学习报告.md`、`_devarchive/repo-analysis/New_Reference_Repos_2026Q3_Analysis.md`、本仓 `src/hooks/useEnhancedMemory.ts`、`src/lib/keyframeMemory.*`

---

# 背景与问题

1. **当前记忆能力偏薄**。现场核实 `src/hooks/useEnhancedMemory.ts`：记忆面板仅对 `keyframeMemory` 做**时间窗过滤 + 前 10 条截取**，`searchMemory` 为占位式线性扫描，无语义检索；`_devarchive` 分析亦指出本仓仅有基础 `vectorSearch.ts`。桌面宠物需要**关系型 + 长期 + 跨会话**记忆（"X 是 Y 的朋友""Z 发生在 W 之后"），现有实现无法支撑。
2. **需引入成熟记忆框架**。候选二选一：
   - **cognee**（`topoteretes/cognee`）：**30,433★ / Apache-2.0 / Python / `pushed_at=2026-09-03`**（当日活跃）。知识图谱 + 向量混合记忆框架，多层记忆架构（图谱记忆 / 长期记忆 / 混合检索），自动从对话抽取实体-关系。`_devarchive` 分析已将其列为推荐（"比当前向量搜索更进一步"）。
   - **memvid**（`memvid/memvid`）：**16,463★ / Apache-2.0 / `pushed_at=2026-07-14`**（约 2 月未推）。"Memory as Video"——将文本记忆编码进视频帧实现极致压缩 + FAISS 语义检索；衍生 **`AllenDang/memvid-rs`（Rust, 62★）** 可原生嵌入本仓 Tauri/Rust 后端。
3. **栈耦合约束**。本仓为 **Tauri v2 + Rust + React19**，无 Python 运行时（详见 `LOCAL_RULES.md`）。cognee（Python）需引入**进程外 sidecar / API server**；memvid-rs（Rust）可原生集成。选型须权衡「记忆能力」与「原生集成/分发重量」。

# 评估的备选方案

- **方案 A：维持现状（keyframeMemory + 占位搜索）** —— 零新增依赖；劣势：无语义/关系记忆，宠物「记不住关系与长期上下文」，达不到养成/陪伴目标。
- **方案 B：采用 cognee 为记忆框架（采纳为主选）** —— 优势：图谱+向量混合检索，关系型记忆天然契合宠物记忆语义；30k★、极活跃、Apache-2.0；`_devarchive` 已背书。劣势：**Python 实现，须以隔离 sidecar / API server 接入**（参考 sibling 仓 `comfy_kernel` 的 vendor+隔离模式），增加分发体积与生命周期管理。
- **方案 C：采用 memvid（memvid-rs）为记忆框架** —— 优势：**Rust 原生、零 Python 依赖**，压缩存储适合长期冷记忆，分发轻。劣势：本质是「压缩+语义检索」存储层，**非关系型记忆框架**，不提供 cognee 的实体-关系图谱推理；主仓约 2 月未活跃，生态成熟度低于 cognee；关系型宠物记忆须自行在 memvid 之上重建。
- **方案 D（混合，最终推荐）**：**cognee 为主记忆框架（关系/语义/长期）**；**memvid-rs 作为可选压缩冷存储层**（长期归档、降低本地体积），仅在 PoC 证明 cognee sidecar 不可接受时，memvid-rs 升为唯一后端（接受关系推理能力降级）。

# 决策

- **主选 cognee**（`topoteretes/cognee`，Apache-2.0）作为 SpiritPal 记忆框架，承载图谱+向量混合检索与长期记忆。
- **集成边界**：cognee 以**隔离 Python sidecar / API server** 形式运行（不混入 Rust 主进程；沿用家族「vendor + 运行时隔离」纪律，类比 comfy_kernel 的 `.dockerignore`/子进程隔离），经 Rust/TS 边界以 HTTP/gRPC 调用。
- **memvid-rs 记为可选补充**：仅用于长期压缩冷存储；不作为关系记忆主后端。若 PoC 阶段 cognee sidecar 在 Tauri 打包/用户机 Python 环境上不可行，则**回退至 memvid-rs 单后端**（明确接受关系推理降级）。
- 本 ADR 为**评估结论**，状态 `Proposed`；适配器/sidecar 实现不在本任务范围，待 PoC 验证后转 Implemented 或修订。

# 实施影响（落地清单，待 PoC 后执行）

- 新增 `src-tauri/` 侧或独立 sidecar：打包 cognee（Python venv，Apache-2.0），以 API server 暴露记忆读写；`LOCAL_RULES.md` 增补「Python sidecar 隔离」条目。
- 新增 `src/lib/memory/cogneeClient.ts`：封装对 cognee 的实体抽取 / 图谱写入 / 混合检索调用，替换 `useEnhancedMemory.ts` 的占位搜索，保留 `keyframeMemory` 作为本地时序索引。
- `docs/FILEMAP.md`：将 `topoteretes_cognee.html` 标注为「已采纳记忆框架」；`memvid/memvid`、`AllenDang/memvid-rs` 标注为「候选压缩冷存储」。
- 合规：cognee / memvid 均 Apache-2.0，无传染风险；sidecar 隔离确保主分发物不捆绑 GPL/未知许可。
- 文档：更新 `README` 记忆架构说明；在 `docs/repo-analysis/` 补 `cognee_技术学习报告.md` / `memvid_技术学习报告.md`（对齐家族竞品报告规范）。

# 可回滚路径与待验证项

- **回滚**：停用 cognee sidecar，`useEnhancedMemory.ts` 回退至 `keyframeMemory` 占位实现（现状）；或切 memvid-rs 单后端。
- **待验证（PoC 门控）**：
  1. cognee sidecar 在 **Tauri v2 打包产物**内可随应用启动（Windows 用户机无预装 Python 场景），记录体积增量与冷启动耗时。
  2. 图谱+向量混合检索在宠物对话样本上，关系型查询（"X 与 Y 的关系"）准确率显著优于当前 `vectorSearch.ts` 占位实现。
  3. 跨会话长期记忆持久化正确（重启后记忆不丢、不串角色——`characterId` 隔离）。
  4. memvid-rs 备选路径：若 cognee sidecar 被否，验证 memvid-rs 在 Rust 后端内可编译运行、压缩率与检索延迟达标（接受无关系推理）。
  5. 许可复核：cognee / memvid-rs 均为 Apache-2.0，sidecar 隔离后主分发物合规无新增风险。
