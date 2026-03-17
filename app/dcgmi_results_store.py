"""
Persist DCGMI diagnostics results to disk and provide query functions.

Each test run is stored as:
    dcgmi_results/<task_id>/summary.json
    dcgmi_results/<task_id>/raw_log.txt
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

RESULTS_DIR = Path(__file__).resolve().parent.parent / "dcgmi_results"


def _ensure_dir() -> None:
    RESULTS_DIR.mkdir(parents=True, exist_ok=True)


def save_result(task_record: dict[str, Any]) -> None:
    """Save a completed (or failed) DCGMI task to disk."""
    _ensure_dir()
    task_id = task_record["task_id"]
    task_dir = RESULTS_DIR / task_id
    task_dir.mkdir(parents=True, exist_ok=True)

    results = _serialise_results(task_record.get("results", []))

    pass_count = 0
    fail_count = 0
    warn_count = 0
    error_hosts = 0
    for r in results:
        if r.get("error"):
            error_hosts += 1
        pass_count += r.get("pass_count", 0)
        fail_count += r.get("fail_count", 0)
        warn_count += r.get("warn_count", 0)

    summary = {
        "task_id": task_id,
        "level": task_record.get("level"),
        "status": task_record.get("status"),
        "started_at": task_record.get("started_at"),
        "finished_at": task_record.get("finished_at"),
        "total_hosts": task_record.get("total_hosts", 0),
        "results": results,
        "pass_count": pass_count,
        "fail_count": fail_count,
        "warn_count": warn_count,
        "error_hosts": error_hosts,
        "error": task_record.get("error"),
    }

    with open(task_dir / "summary.json", "w", encoding="utf-8") as f:
        json.dump(summary, f, ensure_ascii=False, indent=2)

    raw_log = task_record.get("raw_log", "")
    with open(task_dir / "raw_log.txt", "w", encoding="utf-8") as f:
        f.write(raw_log)


def _serialise_results(results: list[dict]) -> list[dict]:
    """Strip raw_log from per-host results for JSON storage."""
    clean: list[dict] = []
    for r in results:
        entry = dict(r)
        entry.pop("raw_log", None)
        clean.append(entry)
    return clean


def list_results() -> list[dict[str, Any]]:
    """Return a list of all saved DCGMI test runs with summary metadata."""
    _ensure_dir()
    items: list[dict[str, Any]] = []
    for task_dir in sorted(RESULTS_DIR.iterdir(), reverse=True):
        summary_file = task_dir / "summary.json"
        if not summary_file.exists():
            continue
        try:
            with open(summary_file, encoding="utf-8") as f:
                s = json.load(f)
            items.append({
                "task_id": s.get("task_id"),
                "level": s.get("level"),
                "status": s.get("status"),
                "started_at": s.get("started_at"),
                "finished_at": s.get("finished_at"),
                "total_hosts": s.get("total_hosts", 0),
                "pass_count": s.get("pass_count", 0),
                "fail_count": s.get("fail_count", 0),
                "warn_count": s.get("warn_count", 0),
                "error_hosts": s.get("error_hosts", 0),
            })
        except (json.JSONDecodeError, KeyError):
            continue
    return items


def get_summary(task_id: str) -> dict[str, Any] | None:
    """Return the full summary.json for a given task_id."""
    summary_file = RESULTS_DIR / task_id / "summary.json"
    if not summary_file.exists():
        return None
    with open(summary_file, encoding="utf-8") as f:
        return json.load(f)


def get_log_path(task_id: str) -> str | None:
    """Return the absolute path to raw_log.txt if it exists."""
    log_file = RESULTS_DIR / task_id / "raw_log.txt"
    if log_file.exists():
        return str(log_file)
    return None
