"""
DCGMI diagnostics API routes — single-host and batch GPU diagnostics,
result queries, and log downloads.
"""

from __future__ import annotations

from typing import Union

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel

from app.dcgmi_results_store import (
    get_log_path,
    get_summary,
    list_results,
    save_result,
)
from app.remote.dcgmi_diag import get_batch_task, run_dcgmi_batch, run_dcgmi_diag
from app.ssh_runner import SSHRunnerError

router = APIRouter(prefix="/api/dcgmi", tags=["dcgmi"])


# ---------------------------------------------------------------------------
# Request models
# ---------------------------------------------------------------------------

class DiagRequest(BaseModel):
    host_id: Union[int, str]
    level: int = 1


class BatchDiagRequest(BaseModel):
    level: int = 1


# ---------------------------------------------------------------------------
# Single-host diagnostics
# ---------------------------------------------------------------------------

@router.post("/diag")
async def post_diag(req: DiagRequest):
    """Run DCGMI diag on a single GPU host (synchronous)."""
    if req.level not in (1, 2):
        raise HTTPException(status_code=400, detail="level must be 1 or 2")

    try:
        hid = int(req.host_id) if isinstance(req.host_id, str) and req.host_id.isdigit() else req.host_id
        result = run_dcgmi_diag(hid, level=req.level)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except SSHRunnerError as exc:
        detail = str(exc)
        if "not found" in detail.lower():
            raise HTTPException(status_code=404, detail=detail)
        raise HTTPException(status_code=502, detail=detail)

    from datetime import datetime
    import uuid as _uuid

    task_id = datetime.now().strftime("%Y%m%d_%H%M%S") + "_dcgmi_" + _uuid.uuid4().hex[:6]
    record = {
        "task_id": task_id,
        "level": req.level,
        "status": "completed",
        "started_at": datetime.now().isoformat(),
        "finished_at": datetime.now().isoformat(),
        "total_hosts": 1,
        "results": [result],
        "raw_log": result.get("raw_log", ""),
    }
    save_result(record)
    result["task_id"] = task_id
    return result


# ---------------------------------------------------------------------------
# Batch diagnostics
# ---------------------------------------------------------------------------

@router.post("/batch")
async def post_batch(req: BatchDiagRequest):
    """Start batch DCGMI diag on all GPU hosts (async, returns task_id)."""
    if req.level not in (1, 2):
        raise HTTPException(status_code=400, detail="level must be 1 or 2")
    try:
        task_id = run_dcgmi_batch(level=req.level)
        return {"task_id": task_id, "status": "running"}
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.get("/batch/{task_id}/status")
async def get_batch_status(task_id: str):
    """Poll the status of a running batch DCGMI test."""
    task = get_batch_task(task_id)
    if task:
        return {
            "task_id": task_id,
            "status": task["status"],
            "total_hosts": task.get("total_hosts", 0),
            "completed_hosts": task.get("completed_hosts", 0),
            "error": task.get("error"),
        }
    summary = get_summary(task_id)
    if summary:
        return {
            "task_id": task_id,
            "status": summary.get("status", "completed"),
            "total_hosts": summary.get("total_hosts", 0),
            "completed_hosts": summary.get("total_hosts", 0),
            "error": summary.get("error"),
        }
    raise HTTPException(status_code=404, detail=f"Task not found: {task_id}")


# ---------------------------------------------------------------------------
# Results queries
# ---------------------------------------------------------------------------

@router.get("/results")
async def get_results():
    """List all saved DCGMI test results."""
    return list_results()


@router.get("/results/{task_id}/summary")
async def get_result_summary(task_id: str):
    """Return the full summary for a specific DCGMI test run."""
    summary = get_summary(task_id)
    if not summary:
        raise HTTPException(status_code=404, detail=f"Result not found: {task_id}")
    return summary


@router.get("/results/{task_id}/log")
async def download_result_log(task_id: str):
    """Download the raw DCGMI test log file."""
    log_path = get_log_path(task_id)
    if not log_path:
        raise HTTPException(status_code=404, detail=f"Log not found: {task_id}")
    return FileResponse(
        log_path,
        media_type="text/plain",
        filename=f"dcgmi_diag_{task_id}.log",
    )
