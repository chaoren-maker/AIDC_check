"""
Ethernet bandwidth test API routes — single-pair and batch iperf tests,
result queries, and log downloads.
"""

from __future__ import annotations

from typing import Union

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel

from app.eth_results_store import get_log_path, get_summary, list_results, save_result
from app.remote.eth_test import get_batch_task, run_eth_batch, run_single_pair
from app.ssh_runner import SSHRunnerError

router = APIRouter(prefix="/api/eth", tags=["ethernet"])


# ---------------------------------------------------------------------------
# Request models
# ---------------------------------------------------------------------------

class SingleTestRequest(BaseModel):
    src_host_id: Union[int, str]
    dst_host_id: Union[int, str]


class BatchTestRequest(BaseModel):
    mode: str = "fullmesh"


# ---------------------------------------------------------------------------
# Single-pair test
# ---------------------------------------------------------------------------

@router.post("/test")
async def post_single_test(req: SingleTestRequest):
    """Run iperf test between two hosts (synchronous)."""
    try:
        result = run_single_pair(req.src_host_id, req.dst_host_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except SSHRunnerError as exc:
        raise HTTPException(status_code=502, detail=str(exc))

    from datetime import datetime
    import uuid as _uuid

    task_id = datetime.now().strftime("%Y%m%d_%H%M%S") + "_eth_" + _uuid.uuid4().hex[:6]
    record = {
        "task_id": task_id,
        "mode": "single",
        "status": "completed",
        "started_at": datetime.now().isoformat(),
        "finished_at": datetime.now().isoformat(),
        "total_pairs": 1,
        "results": [result],
        "raw_log": result.get("raw_log", ""),
    }
    save_result(record)
    result["task_id"] = task_id
    return result


# ---------------------------------------------------------------------------
# Batch test
# ---------------------------------------------------------------------------

@router.post("/batch")
async def post_batch(req: BatchTestRequest):
    """Start batch Ethernet bandwidth test (async, returns task_id)."""
    if req.mode not in ("fullmesh", "sequential"):
        raise HTTPException(status_code=400, detail="mode must be 'fullmesh' or 'sequential'")
    try:
        task_id = run_eth_batch(mode=req.mode)
        return {"task_id": task_id, "status": "running"}
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.get("/batch/{task_id}/status")
async def get_batch_status(task_id: str):
    """Poll the status of a running batch Ethernet test."""
    task = get_batch_task(task_id)
    if task:
        return {
            "task_id": task_id,
            "status": task["status"],
            "total_pairs": task.get("total_pairs", 0),
            "completed_pairs": task.get("completed_pairs", 0),
            "error": task.get("error"),
        }
    summary = get_summary(task_id)
    if summary:
        return {
            "task_id": task_id,
            "status": summary.get("status", "completed"),
            "total_pairs": summary.get("total_pairs", 0),
            "completed_pairs": summary.get("total_pairs", 0),
            "error": summary.get("error"),
        }
    raise HTTPException(status_code=404, detail=f"Task not found: {task_id}")


# ---------------------------------------------------------------------------
# Results queries
# ---------------------------------------------------------------------------

@router.get("/results")
async def get_results():
    """List all saved Ethernet test results."""
    return list_results()


@router.get("/results/{task_id}/summary")
async def get_result_summary(task_id: str):
    """Return the full summary for a specific Ethernet test run."""
    summary = get_summary(task_id)
    if not summary:
        raise HTTPException(status_code=404, detail=f"Result not found: {task_id}")
    return summary


@router.get("/results/{task_id}/log")
async def download_result_log(task_id: str):
    """Download the raw iperf test log file."""
    log_path = get_log_path(task_id)
    if not log_path:
        raise HTTPException(status_code=404, detail=f"Log not found: {task_id}")
    return FileResponse(
        log_path,
        media_type="text/plain",
        filename=f"eth_test_{task_id}.log",
    )
