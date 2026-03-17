"""
DCGMI diagnostics runner — Level 1 (quick) and Level 2 (medium).

Executes `dcgmi diag -r <level>` on remote GPU hosts via SSH, parses the
tabular output into structured results, and supports batch execution across
all GPU-type hosts with background threading.
"""

from __future__ import annotations

import logging
import re
import threading
import uuid
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime
from typing import Any

from app.host_store import get_hosts_safe, resolve_host
from app.ssh_runner import SSHRunnerError, run_remote_command

logger = logging.getLogger(__name__)

LEVEL_TIMEOUTS = {1: 120, 2: 600}
DEFAULT_MAX_CONCURRENT = 10

_batch_tasks: dict[str, dict[str, Any]] = {}


def get_batch_task(task_id: str) -> dict[str, Any] | None:
    return _batch_tasks.get(task_id)


# ---------------------------------------------------------------------------
# Output parser
# ---------------------------------------------------------------------------

def parse_dcgmi_output(raw: str) -> dict[str, Any]:
    """Parse dcgmi diag tabular output into structured categories/tests.

    Returns:
        {
            "categories": [{"name": str, "tests": [{"name", "result", "detail"}]}],
            "overall": "Pass" | "Fail" | "Warn" | "Skip",
            "pass_count": int,
            "fail_count": int,
            "warn_count": int,
        }
    """
    categories: list[dict[str, Any]] = []
    current_category: str | None = None
    current_tests: list[dict[str, Any]] = []

    has_fail = False
    has_warn = False
    pass_count = 0
    fail_count = 0
    warn_count = 0

    category_re = re.compile(r"^\|[-]+\s+(.+?)\s+[-]+\+")
    test_re = re.compile(r"^\|\s*(.+?)\s*\|\s*(.+?)\s*\|")

    for line in raw.splitlines():
        line = line.rstrip()

        cat_match = category_re.match(line)
        if cat_match:
            if current_category and current_tests:
                categories.append({"name": current_category, "tests": list(current_tests)})
            current_category = cat_match.group(1).strip()
            current_tests = []
            continue

        test_match = test_re.match(line)
        if not test_match:
            continue

        name = test_match.group(1).strip()
        raw_result = test_match.group(2).strip()

        if not name or name.startswith("-") or name.startswith("="):
            continue
        if name.lower() in ("diagnostic", "diagnostic "):
            continue

        result = "Pass"
        detail = ""
        lower = raw_result.lower()
        if lower.startswith("fail"):
            result = "Fail"
            has_fail = True
            fail_count += 1
            detail = raw_result[len("Fail"):].strip(" -")
        elif lower.startswith("warn"):
            result = "Warn"
            has_warn = True
            warn_count += 1
            detail = raw_result[len("Warn"):].strip(" -")
        elif lower.startswith("skip"):
            result = "Skip"
            detail = raw_result[len("Skip"):].strip(" -")
        elif lower.startswith("pass"):
            pass_count += 1
        else:
            result = raw_result
            pass_count += 1

        current_tests.append({"name": name, "result": result, "detail": detail})

    if current_category and current_tests:
        categories.append({"name": current_category, "tests": list(current_tests)})

    overall = "Fail" if has_fail else ("Warn" if has_warn else "Pass")

    return {
        "categories": categories,
        "overall": overall,
        "pass_count": pass_count,
        "fail_count": fail_count,
        "warn_count": warn_count,
    }


# ---------------------------------------------------------------------------
# Single-host diagnostics
# ---------------------------------------------------------------------------

def run_dcgmi_diag(host_id: int | str, level: int = 1) -> dict[str, Any]:
    """SSH to a single host and run dcgmi diag.

    Args:
        host_id: Host id or IP.
        level: Diagnostic level (1 or 2).

    Returns:
        Structured result dict with parsed output and raw log.

    Raises:
        SSHRunnerError: On SSH / command failure.
        ValueError: If level is invalid.
    """
    if level not in (1, 2):
        raise ValueError(f"Unsupported DCGMI diag level: {level} (must be 1 or 2)")

    host = resolve_host(host_id)
    if not host:
        raise SSHRunnerError(f"Host not found: {host_id}")

    timeout = LEVEL_TIMEOUTS.get(level, 120)
    cmd = f"dcgmi diag -r {level} 2>&1"

    stdout, stderr, exit_code = run_remote_command(host_id, cmd, timeout=timeout)
    raw_log = stdout + stderr

    parsed = parse_dcgmi_output(stdout)
    return {
        "host_id": host.get("id", host_id),
        "host_ip": host["host_ip"],
        "hostname": host.get("hostname", ""),
        "level": level,
        "exit_code": exit_code,
        **parsed,
        "raw_log": raw_log,
    }


# ---------------------------------------------------------------------------
# Batch diagnostics
# ---------------------------------------------------------------------------

def _run_single_host(host_id: int, level: int) -> dict[str, Any]:
    """Execute DCGMI diag on one host, returning result or error dict."""
    try:
        return run_dcgmi_diag(host_id, level)
    except (SSHRunnerError, Exception) as exc:
        host = resolve_host(host_id)
        return {
            "host_id": host_id,
            "host_ip": host["host_ip"] if host else str(host_id),
            "hostname": host.get("hostname", "") if host else "",
            "level": level,
            "exit_code": -1,
            "categories": [],
            "overall": "Error",
            "pass_count": 0,
            "fail_count": 0,
            "warn_count": 0,
            "error": str(exc),
            "raw_log": f"Error: {exc}\n",
        }


def run_dcgmi_batch(
    level: int = 1,
    max_concurrent: int = DEFAULT_MAX_CONCURRENT,
) -> str:
    """Start batch DCGMI diagnostics on all GPU hosts.

    Returns a task_id immediately; the test runs in a background thread.
    """
    hosts = get_hosts_safe()
    gpu_hosts = [h for h in hosts if h.get("device_type", "GPU") == "GPU"]
    if not gpu_hosts:
        raise ValueError("No GPU hosts found for DCGMI diagnostics")

    task_id = datetime.now().strftime("%Y%m%d_%H%M%S") + "_dcgmi_" + uuid.uuid4().hex[:6]
    task_record: dict[str, Any] = {
        "task_id": task_id,
        "level": level,
        "status": "running",
        "started_at": datetime.now().isoformat(),
        "total_hosts": len(gpu_hosts),
        "completed_hosts": 0,
        "results": [],
        "raw_log": "",
        "error": None,
    }
    _batch_tasks[task_id] = task_record

    def _execute():
        try:
            all_results: list[dict] = []
            all_raw_log: list[str] = []

            effective = min(len(gpu_hosts), max_concurrent)
            with ThreadPoolExecutor(max_workers=effective) as pool:
                futures = {
                    pool.submit(_run_single_host, h["id"], level): h["id"]
                    for h in gpu_hosts
                }
                for future in as_completed(futures):
                    result = future.result()
                    all_results.append(result)
                    all_raw_log.append(result.get("raw_log", ""))
                    task_record["completed_hosts"] += 1

            task_record["results"] = all_results
            task_record["raw_log"] = "\n".join(all_raw_log)
            task_record["status"] = "completed"
            task_record["finished_at"] = datetime.now().isoformat()

            from app.dcgmi_results_store import save_result
            save_result(task_record)

        except Exception as exc:
            logger.exception("DCGMI batch test failed")
            task_record["status"] = "failed"
            task_record["error"] = str(exc)
            task_record["finished_at"] = datetime.now().isoformat()

    t = threading.Thread(target=_execute, daemon=True)
    t.start()

    return task_id
