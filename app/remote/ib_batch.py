"""
Batch IB testing — auto-pair hosts using dual mode, group without conflict,
execute in parallel via ThreadPoolExecutor (async-friendly with FastAPI).
"""

from __future__ import annotations

import logging
import uuid
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime
from typing import Any

from app.host_store import get_hosts_safe, resolve_host
from app.remote.ib_cards import discover_ib_cards
from app.remote.ib_config import DEFAULT_MAX_CONCURRENT
from app.remote.ib_test import run_bandwidth_test, run_latency_test
from app.ssh_runner import SSHRunnerError

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Pairing logic  (dual mode, ported from ib-bench)
# ---------------------------------------------------------------------------

def generate_pairs_dual(hosts: list[dict[str, Any]]) -> list[tuple[int, int]]:
    """Split loaded hosts into two halves and pair them by index.

    Returns list of (server_host_id, client_host_id).
    """
    if len(hosts) < 2:
        return []

    half = len(hosts) // 2
    servers = hosts[:half]
    clients = hosts[half: 2 * half]

    pairs = [(s["id"], c["id"]) for s, c in zip(servers, clients)]

    remaining = hosts[2 * half:]
    if remaining and servers:
        first_server_id = servers[0]["id"]
        for r in remaining:
            pairs.append((first_server_id, r["id"]))

    return pairs


# ---------------------------------------------------------------------------
# Conflict-free grouping  (greedy, ported from ib-bench)
# ---------------------------------------------------------------------------

def group_pairs_no_conflict(
    pairs: list[tuple[int, int]],
) -> list[list[tuple[int, int]]]:
    """Group pairs so that within each group no host_id appears twice.

    This allows each group to be executed fully in parallel.
    """
    if not pairs:
        return []

    groups: list[list[tuple[int, int]]] = []

    for pair in pairs:
        s_id, c_id = pair
        placed = False
        for group in groups:
            conflict = False
            for existing_s, existing_c in group:
                if s_id in (existing_s, existing_c) or c_id in (existing_s, existing_c):
                    conflict = True
                    break
            if not conflict:
                group.append(pair)
                placed = True
                break
        if not placed:
            groups.append([pair])

    return groups


# ---------------------------------------------------------------------------
# Batch execution engine
# ---------------------------------------------------------------------------

# In-memory task tracker (shared with ib_results_store)
_batch_tasks: dict[str, dict[str, Any]] = {}


def get_batch_task(task_id: str) -> dict[str, Any] | None:
    return _batch_tasks.get(task_id)


def _run_single_pair(
    test_type: str,
    server_id: int,
    client_id: int,
    bidirectional: bool,
) -> dict[str, Any]:
    """Execute a single test pair and return a result dict."""
    try:
        if test_type == "bandwidth":
            return run_bandwidth_test(server_id, client_id, bidirectional=bidirectional)
        else:
            return run_latency_test(server_id, client_id)
    except SSHRunnerError as exc:
        server = resolve_host(server_id)
        client = resolve_host(client_id)
        return {
            "server_ip": server["host_ip"] if server else str(server_id),
            "client_ip": client["host_ip"] if client else str(client_id),
            "test_type": test_type,
            "pairs": [],
            "error": str(exc),
            "raw_log": f"Error: {exc}\n",
        }


def run_batch_test(
    test_type: str,
    bidirectional: bool = False,
    max_concurrent: int = DEFAULT_MAX_CONCURRENT,
) -> str:
    """Start a batch test asynchronously.

    Returns a task_id immediately. The test runs in a background thread.
    """
    hosts = get_hosts_safe()
    if len(hosts) < 2:
        raise ValueError("At least 2 hosts are required for batch testing")

    host_id_list = [{"id": h["id"], "host_ip": h["host_ip"]} for h in hosts]
    pairs = generate_pairs_dual(host_id_list)
    if not pairs:
        raise ValueError("Could not generate any test pairs from loaded hosts")

    groups = group_pairs_no_conflict(pairs)

    task_id = datetime.now().strftime("%Y%m%d_%H%M%S") + "_" + uuid.uuid4().hex[:6]
    task_record: dict[str, Any] = {
        "task_id": task_id,
        "test_type": test_type,
        "bidirectional": bidirectional,
        "status": "running",
        "started_at": datetime.now().isoformat(),
        "total_pairs": len(pairs),
        "completed_pairs": 0,
        "results": [],
        "raw_log": "",
        "error": None,
    }
    _batch_tasks[task_id] = task_record

    import threading

    def _execute():
        try:
            all_results: list[dict] = []
            all_raw_log: list[str] = []

            for group_idx, group in enumerate(groups):
                effective_concurrent = min(len(group), max_concurrent)
                with ThreadPoolExecutor(max_workers=effective_concurrent) as pool:
                    futures = {
                        pool.submit(
                            _run_single_pair, test_type, s_id, c_id, bidirectional
                        ): (s_id, c_id)
                        for s_id, c_id in group
                    }
                    for future in as_completed(futures):
                        result = future.result()
                        all_results.append(result)
                        all_raw_log.append(result.get("raw_log", ""))
                        task_record["completed_pairs"] += 1

            task_record["results"] = all_results
            task_record["raw_log"] = "".join(all_raw_log)
            task_record["status"] = "completed"
            task_record["finished_at"] = datetime.now().isoformat()

            # Persist results
            from app.ib_results_store import save_result
            save_result(task_record)

        except Exception as exc:
            logger.exception("Batch test failed")
            task_record["status"] = "failed"
            task_record["error"] = str(exc)
            task_record["finished_at"] = datetime.now().isoformat()

    t = threading.Thread(target=_execute, daemon=True)
    t.start()

    return task_id
