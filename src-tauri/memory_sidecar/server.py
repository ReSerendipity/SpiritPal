"""
SpiritPal 记忆系统 — cognee 隔离 sidecar（SCAFFOLD）

ADR-0003：cognee（Apache-2.0）作为主记忆框架，承载图谱+向量混合检索与长期记忆；
以**隔离进程外 API server** 形式运行（不混入 Rust 主进程），经 HTTP 被前端调用。
参考 sibling 仓 comfy_kernel 的 vendor + 运行时隔离纪律。

⚠️ SCAFFOLD 标记：cognee 具体 API 字段名（add / cognify / search）需在 PoC 阶段
按选定版本对齐；下方为合理默认调用形态，未知字段均标 TODO。
"""
from __future__ import annotations

import logging
import os
from typing import Any

logging.basicConfig(level=logging.INFO)
_log = logging.getLogger("spiritpal.memory_sidecar")

try:
    from fastapi import FastAPI, HTTPException
    from pydantic import BaseModel
except ImportError as e:  # pragma: no cover
    raise SystemExit(f"memory_sidecar 依赖缺失，请先运行 bootstrap 脚本: {e}")

app = FastAPI(title="SpiritPal Memory Sidecar (cognee)")

# cognee 运行时惰性导入（避免打包产物无 Python 环境时硬性失败）
_COGNEE = None


def _cognee():
    global _COGNEE
    if _COGNEE is None:
        try:
            import cognee
            _COGNEE = cognee
        except ImportError as e:  # pragma: no cover
            raise RuntimeError(f"cognee 未安装：{e}") from e
    return _COGNEE


class AddRequest(BaseModel):
    character_id: str
    text: str
    metadata: dict = {}


class SearchRequest(BaseModel):
    character_id: str
    query: str
    top_k: int = 5


def _cognee_available() -> bool:
    try:
        _cognee()
        return True
    except Exception:
        return False


@app.get("/health")
def health() -> dict:
    return {"status": "ok", "cognee_available": _cognee_available()}


@app.post("/memory/add")
def memory_add(req: AddRequest) -> dict:
    """抽取实体-关系并写入 cognee 知识图谱（按 character_id 隔离数据集）。"""
    cog = _cognee()
    try:
        # SCAFFOLD：cognee API 字段名待 PoC 对齐；以下为合理默认调用形态
        cog.set_datasets([req.character_id])  # type: ignore[attr-defined]
        cog.add(req.text)  # type: ignore[attr-defined]
        cog.cognify()  # type: ignore[attr-defined]
        return {"ok": True, "character_id": req.character_id}
    except Exception as e:  # pragma: no cover
        raise HTTPException(status_code=500, detail=f"cognee add failed: {e}")


@app.post("/memory/search")
def memory_search(req: SearchRequest) -> dict:
    """图谱+向量混合检索（关系型记忆："X 与 Y 的关系"）。"""
    cog = _cognee()
    try:
        cog.set_datasets([req.character_id])  # type: ignore[attr-defined]
        results = cog.search(req.query, top_k=req.top_k)  # type: ignore[attr-defined]
        items = [
            {"text": getattr(r, "text", str(r)), "score": getattr(r, "score", None)}
            for r in (results or [])
        ]
        return {"ok": True, "results": items}
    except Exception as e:  # pragma: no cover
        raise HTTPException(status_code=500, detail=f"cognee search failed: {e}")


if __name__ == "__main__":
    import uvicorn

    port = int(os.environ.get("SPIRITPAL_MEMORY_PORT", "7531"))
    uvicorn.run(app, host="127.0.0.1", port=port)
