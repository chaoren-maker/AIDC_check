"""
Remote GPU metrics and inspection (temperature, memory, utilization; thresholds and summary).
"""

from __future__ import annotations

import os
import re
from typing import Any

from app.ssh_runner import run_and_get_stdout, SSHRunnerError

DEFAULT_MAX_TEMP_C = 90
DEFAULT_MAX_MEMORY_PERCENT = 95


def _get_max_temp() -> int:
    return int(os.environ.get("GPU_INSPECTION_MAX_TEMP_C", DEFAULT_MAX_TEMP_C))


def _get_max_memory_percent() -> int:
    return int(os.environ.get("GPU_INSPECTION_MAX_MEMORY_PERCENT", DEFAULT_MAX_MEMORY_PERCENT))


def fetch_gpu_metrics(host_id: int | str, timeout: int = 30) -> dict[str, Any]:
    """Run nvidia-smi --query on remote; return per-GPU temperature, memory, utilization."""
    try:
        out = run_and_get_stdout(
            host_id,
            "nvidia-smi --query-gpu=index,name,temperature.gpu,memory.used,memory.total,utilization.gpu,utilization.memory --format=csv,noheader,nounits 2>/dev/null || true",
            timeout=timeout,
        )
    except SSHRunnerError:
        raise
    gpus: list[dict[str, Any]] = []
    for line in out.strip().splitlines():
        line = line.strip()
        if not line:
            continue
        parts = [p.strip() for p in line.split(",")]
        if len(parts) < 7:
            continue
        try:
            mem_used = int(parts[3]) if parts[3].isdigit() else 0
            mem_total = int(parts[4]) if parts[4].isdigit() else 1
            util_gpu = int(parts[5]) if parts[5].isdigit() else 0
            util_mem = int(parts[6]) if parts[6].isdigit() else 0
        except (ValueError, IndexError):
            mem_used = mem_total = 1
            util_gpu = util_mem = 0
        gpus.append({
            "index": int(parts[0]) if parts[0].isdigit() else len(gpus),
            "name": parts[1],
            "temperature_gpu": int(parts[2]) if parts[2].isdigit() else None,
            "memory_used_mb": mem_used,
            "memory_total_mb": mem_total,
            "memory_used_percent": round(100 * mem_used / mem_total, 1) if mem_total else 0,
            "utilization_gpu_percent": util_gpu,
            "utilization_memory_percent": util_mem,
        })
    return {"gpus": gpus}


def run_inspection(
    host_id: int | str,
    timeout: int = 30,
    max_temp: int | None = None,
    max_memory_percent: int | None = None,
) -> dict[str, Any]:
    """
    Fetch GPU metrics, apply thresholds, return per-GPU status (ok/warning/error) and summary.
    """
    max_t = max_temp if max_temp is not None else _get_max_temp()
    max_mem = max_memory_percent if max_memory_percent is not None else _get_max_memory_percent()
    try:
        data = fetch_gpu_metrics(host_id, timeout=timeout)
    except SSHRunnerError:
        raise
    gpus = data.get("gpus", [])
    summary = {"total": len(gpus), "ok": 0, "warning": 0, "error": 0}
    for g in gpus:
        status = "ok"
        temp = g.get("temperature_gpu")
        mem_pct = g.get("memory_used_percent", 0)
        if temp is not None and temp >= max_t:
            status = "error"
        elif temp is not None and temp >= max_t - 10:
            status = "warning" if status == "ok" else status
        if mem_pct >= max_mem:
            status = "error" if status != "error" else "error"
        elif mem_pct >= max_mem - 10:
            if status == "ok":
                status = "warning"
        g["inspection_status"] = status
        summary[status] = summary.get(status, 0) + 1
    return {"gpus": gpus, "summary": summary, "thresholds": {"max_temp_c": max_t, "max_memory_percent": max_mem}}
