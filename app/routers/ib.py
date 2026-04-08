"""
IB testing API routes — card discovery, single-pair tests, batch tests,
results queries and log downloads.
"""

from __future__ import annotations

from typing import Optional, Union

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse, PlainTextResponse
from pydantic import BaseModel

from app.ib_results_store import get_log_path, get_summary, list_results
from app.mock_data import (
    ib_batch_start,
    ib_batch_status,
    ib_cards,
    ib_results_list,
    ib_single,
    ib_summary,
    is_mock_enabled,
)
from app.remote.ib_batch import get_batch_task, run_batch_test
from app.remote.ib_cards import discover_ib_cards
from app.remote.ib_test import run_bandwidth_test, run_latency_test
from app.ssh_runner import SSHRunnerError

router = APIRouter(prefix="/api/ib", tags=["ib"])


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _parse_host_id(host_id: str) -> Union[int, str]:
    try:
        return int(host_id)
    except ValueError:
        return host_id


def _handle_ssh_error(exc: SSHRunnerError):
    detail = str(exc)
    if "not found" in detail.lower():
        raise HTTPException(status_code=404, detail=detail)
    raise HTTPException(status_code=502, detail=detail)


# ---------------------------------------------------------------------------
# 7.2 — IB card discovery
# ---------------------------------------------------------------------------

@router.get("/{host_id}/cards")
async def get_ib_cards(host_id: str):
    """Discover InfiniBand cards on a remote host."""
    if is_mock_enabled():
        try:
            return ib_cards(host_id)
        except ValueError as exc:
            raise HTTPException(status_code=404, detail=str(exc))
    hid = _parse_host_id(host_id)
    try:
        return discover_ib_cards(hid)
    except SSHRunnerError as exc:
        _handle_ssh_error(exc)


# ---------------------------------------------------------------------------
# 7.3 — Single-pair bandwidth test
# ---------------------------------------------------------------------------

class BandwidthTestRequest(BaseModel):
    server_id: Union[int, str]
    client_id: Union[int, str]
    bidirectional: bool = False
    server_dev: Optional[str] = None
    client_dev: Optional[str] = None


@router.post("/test/bandwidth")
async def post_bandwidth_test(req: BandwidthTestRequest):
    """Run ib_write_bw between two hosts."""
    if is_mock_enabled():
        result = ib_single("bandwidth", bidirectional=req.bidirectional)
        result["task_id"] = ib_batch_start("bandwidth", bidirectional=req.bidirectional)
        return result
    try:
        result = run_bandwidth_test(
            req.server_id, req.client_id,
            bidirectional=req.bidirectional,
            server_dev=req.server_dev, client_dev=req.client_dev,
        )
        # Also persist single-pair results
        from datetime import datetime
        import uuid as _uuid
        from app.ib_results_store import save_result

        task_id = datetime.now().strftime("%Y%m%d_%H%M%S") + "_" + _uuid.uuid4().hex[:6]
        record = {
            "task_id": task_id,
            "test_type": "bandwidth",
            "bidirectional": req.bidirectional,
            "status": "completed",
            "started_at": datetime.now().isoformat(),
            "finished_at": datetime.now().isoformat(),
            "total_pairs": len(result.get("pairs", [])),
            "results": [result],
            "raw_log": result.get("raw_log", ""),
        }
        save_result(record)
        result["task_id"] = task_id
        return result
    except SSHRunnerError as exc:
        _handle_ssh_error(exc)


# ---------------------------------------------------------------------------
# 7.4 — Single-pair latency test
# ---------------------------------------------------------------------------

class LatencyTestRequest(BaseModel):
    server_id: Union[int, str]
    client_id: Union[int, str]
    server_dev: Optional[str] = None
    client_dev: Optional[str] = None


@router.post("/test/latency")
async def post_latency_test(req: LatencyTestRequest):
    """Run ib_write_lat between two hosts."""
    if is_mock_enabled():
        result = ib_single("latency", bidirectional=False)
        result["task_id"] = ib_batch_start("latency", bidirectional=False)
        return result
    try:
        result = run_latency_test(
            req.server_id, req.client_id,
            server_dev=req.server_dev, client_dev=req.client_dev,
        )
        from datetime import datetime
        import uuid as _uuid
        from app.ib_results_store import save_result

        task_id = datetime.now().strftime("%Y%m%d_%H%M%S") + "_" + _uuid.uuid4().hex[:6]
        record = {
            "task_id": task_id,
            "test_type": "latency",
            "bidirectional": False,
            "status": "completed",
            "started_at": datetime.now().isoformat(),
            "finished_at": datetime.now().isoformat(),
            "total_pairs": len(result.get("pairs", [])),
            "results": [result],
            "raw_log": result.get("raw_log", ""),
        }
        save_result(record)
        result["task_id"] = task_id
        return result
    except SSHRunnerError as exc:
        _handle_ssh_error(exc)


# ---------------------------------------------------------------------------
# 7.5 — Batch test
# ---------------------------------------------------------------------------

class BatchTestRequest(BaseModel):
    test_type: str  # "bandwidth" | "latency"
    bidirectional: bool = False


@router.post("/test/batch")
async def post_batch_test(req: BatchTestRequest):
    """Start a batch test across all loaded hosts (async)."""
    if req.test_type not in ("bandwidth", "latency"):
        raise HTTPException(status_code=400, detail="test_type must be 'bandwidth' or 'latency'")
    if is_mock_enabled():
        return {"task_id": ib_batch_start(req.test_type, req.bidirectional), "status": "running"}
    try:
        task_id = run_batch_test(
            test_type=req.test_type,
            bidirectional=req.bidirectional,
        )
        return {"task_id": task_id, "status": "running"}
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


# ---------------------------------------------------------------------------
# 7.6 — Batch test status
# ---------------------------------------------------------------------------

@router.get("/test/batch/{task_id}/status")
async def get_batch_status(task_id: str):
    """Poll the status of a running batch test."""
    if is_mock_enabled():
        s = ib_batch_status(task_id)
        if not s:
            raise HTTPException(status_code=404, detail=f"Task not found: {task_id}")
        return s
    task = get_batch_task(task_id)
    if task:
        return {
            "task_id": task_id,
            "status": task["status"],
            "total_pairs": task.get("total_pairs", 0),
            "completed_pairs": task.get("completed_pairs", 0),
            "error": task.get("error"),
        }
    # Try disk
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
# 7.7 — List historical results
# ---------------------------------------------------------------------------

@router.get("/results")
async def get_results():
    """List all saved IB test results."""
    if is_mock_enabled():
        return ib_results_list()
    return list_results()


# ---------------------------------------------------------------------------
# 7.8 — Get result summary
# ---------------------------------------------------------------------------

@router.get("/results/{task_id}/summary")
async def get_result_summary(task_id: str):
    """Return the full summary for a specific test run."""
    if is_mock_enabled():
        summary = ib_summary(task_id)
        if not summary:
            raise HTTPException(status_code=404, detail=f"Result not found: {task_id}")
        return summary
    summary = get_summary(task_id)
    if not summary:
        raise HTTPException(status_code=404, detail=f"Result not found: {task_id}")
    return summary


# ---------------------------------------------------------------------------
# 7.9 — Download test log
# ---------------------------------------------------------------------------

@router.get("/results/{task_id}/log")
async def download_result_log(task_id: str):
    """Download the raw test log file."""
    if is_mock_enabled():
        summary = ib_summary(task_id)
        if not summary:
            raise HTTPException(status_code=404, detail=f"Log not found: {task_id}")
        return PlainTextResponse(
            summary.get("raw_log", "[MOCK] no log"),
            media_type="text/plain",
            headers={"Content-Disposition": f'attachment; filename="ib_test_{task_id}.log"'},
        )
    log_path = get_log_path(task_id)
    if not log_path:
        raise HTTPException(status_code=404, detail=f"Log not found: {task_id}")
    return FileResponse(
        log_path,
        media_type="text/plain",
        filename=f"ib_test_{task_id}.log",
    )
