# 本地仓库管理规则

1. 【铁律】本地内容一律不允许删除；任何删除操作先列出步骤给仓库所有者审核，获批准后才能执行。
2. 远程展示内容由 .gitignore 控制：只用 `git rm --cached` + .gitignore 规则控制远程内容。
3. 语言约定：文档/说明以中文为主，代码与标识符保持英文。
4. **变更隔离（家族仓库适用）**：本项目**只做 SpiritPal 本仓库**的改动；工作区内其他家族仓库（TTS_MultiModel / DraftPeek / Image_MultiModel / MiniMax-H3-lite / SeedVR2-lite）与本任务无关；**禁止**未经用户要求修改其他仓库的任何文件（含其 AGENTS.md / README.md / 规范文档）；跨仓库借鉴必须先在本仓 `docs/reports/` 留落地记录。
5. 单一事实来源：文档冲突按 AGENTS.md 第 0 节仲裁顺序处理。