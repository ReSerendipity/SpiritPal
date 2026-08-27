# 需求追溯标签体系

> **文档编号**：RT-001  
> **创建日期**：2026-08-27  
> **适用范围**：SpiritPal 全项目

---

## 1. 目的

建立从「业务需求 → 代码实现 → 自动化用例」的双向可追溯性，解决以下问题：

- 需求变更时无法快速定位受影响的代码和测试
- 代码修改后无法反向追溯到原始需求
- 测试用例与需求 AC 无强绑定

---

## 2. 标签格式

### 2.1 代码注释标签（正向追溯：需求 → 代码）

在代码文件头部或函数/组件定义处添加注释：

```typescript
/**
 * @req PRD-7.2-F1.3  Live2D 渲染引擎
 * @req PRD-13.1      Phase 1 验收：宠物渲染
 * @see docs/project/PRD_桌面宠物应用_v0.2.md §7.2 F1.3, §13.1
 */
```

### 2.2 测试注释标签（反向追溯：测试 → 需求）

在测试文件 `describe` 或 `it` 块上方添加注释：

```typescript
/**
 * @see PRD-13.1-AC1  宠物在透明窗口中 Live2D 正常显示，30fps
 * @see .trae/specs/prd-v02-full-completion/checklist.md Phase 1
 */
describe('Live2D 渲染', () => {
  it('should render model in transparent window', async () => { ... })
})
```

### 2.3 E2E spec 标签

在 E2E 测试文件头部添加 `@see` 关联：

```typescript
/**
 * E2E: 应用启动 → 宠物窗口可见
 * @see PRD-13.1-AC1  透明窗口中 Live2D 宠物正常显示
 * @see .trae/specs/prd-v02-full-completion/checklist.md Phase 1 - 宠物渲染
 */
```

---

## 3. 需求 ID 命名规则

| 格式 | 含义 | 示例 |
|------|------|------|
| `PRD-<章节>-<功能编号>` | PRD 中的功能需求 | `PRD-7.2-F1.3`（F1 第 3 子项） |
| `PRD-<章节>-AC<n>` | PRD 中的验收条件 | `PRD-13.1-AC1` |
| `SPEC-<spec目录>-<序号>` | .trae/specs 中的 Spec | `SPEC-prd-v02-01` |
| `TASK-<清单编号>-<序号>` | 任务清单中的任务 | `TASK-next-2.1` |

---

## 4. 试点范围

以下文件已添加追溯标签作为试点：

| 文件 | 关联需求 | 标签类型 |
|------|---------|---------|
| `e2e/smoke.spec.ts` | PRD-13.1-AC1 | @see |
| `e2e/pet-window.spec.ts` | PRD-13.1-AC2~AC4 | @see |
| `e2e/nurturing.spec.ts` | PRD-13.2-AC1 | @see |

后续新增 E2E 测试必须包含 `@see` 注释，关联到 PRD 章节号或 Spec checklist 项。

---

## 5. 维护规则

1. **新增需求时**：在 PRD 或 Spec 中定义需求 ID，同步更新本文件第 4 节
2. **新增代码时**：在文件或函数头部添加 `@req` 注释关联需求 ID
3. **新增测试时**：在 `describe` 或文件头部添加 `@see` 注释关联 AC
4. **需求变更时**：通过 `grep -r "@req PRD-7.2-F1.3"` 快速定位受影响代码
5. **删除代码时**：同步删除对应的 `@req` 标签，避免悬挂引用

---

## 6. 验证方法

```bash
# 查找某需求关联的代码
grep -r "@req PRD-7.2-F1.3" src/

# 查找某 AC 关联的测试
grep -r "@see PRD-13.1-AC1" e2e/ src/**/__tests__/

# 统计已标记追溯的文件数
grep -rl "@req\|@see.*PRD" src/ e2e/ | wc -l
```
