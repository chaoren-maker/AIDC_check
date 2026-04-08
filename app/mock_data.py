"""
Mock data and task simulation for no-GPU demo mode.
"""

from __future__ import annotations

import os
import uuid
from datetime import datetime
from typing import Any


def is_mock_enabled() -> bool:
    v = os.getenv("AIDC_MOCK_MODE", "").strip().lower()
    return v in {"1", "true", "yes", "on"}


def mock_scenario() -> str:
    v = os.getenv("AIDC_MOCK_SCENARIO", "warning").strip().lower()
    if v not in {"healthy", "warning", "degraded"}:
        return "warning"
    return v


def mock_status_payload() -> dict[str, Any]:
    return {"enabled": is_mock_enabled(), "scenario": mock_scenario()}


MOCK_HOSTS: list[dict[str, Any]] = [
    {
        "id": 101,
        "host_ip": "10.10.1.11",
        "hostname": "gpu-a01",
        "username": "root",
        "device_type": "GPU",
        "auth_type": "key",
        "ssh_port": 22,
        "remark": "mock-gpu",
    },
    {
        "id": 102,
        "host_ip": "10.10.1.12",
        "hostname": "gpu-a02",
        "username": "root",
        "device_type": "GPU",
        "auth_type": "key",
        "ssh_port": 22,
        "remark": "mock-gpu",
    },
    {
        "id": 201,
        "host_ip": "10.10.2.21",
        "hostname": "cpu-b01",
        "username": "admin",
        "device_type": "CPU",
        "auth_type": "password",
        "ssh_port": 22,
        "remark": "mock-cpu",
    },
]

HOST_BY_ID = {int(h["id"]): h for h in MOCK_HOSTS}
PING_BY_SCENARIO = {
    "healthy": {101: True, 102: True, 201: True},
    "warning": {101: True, 102: True, 201: False},
    "degraded": {101: True, 102: False, 201: False},
}


def list_hosts_safe() -> list[dict[str, Any]]:
    return [h.copy() for h in MOCK_HOSTS]


def _to_host_id(host_id: Any) -> int:
    if isinstance(host_id, str):
        if host_id.isdigit():
            return int(host_id)
        for h in MOCK_HOSTS:
            if h["host_ip"] == host_id:
                return int(h["id"])
    if isinstance(host_id, int):
        return host_id
    raise ValueError(f"Host not found: {host_id}")


def get_host_or_raise(host_id: Any) -> dict[str, Any]:
    hid = _to_host_id(host_id)
    if hid not in HOST_BY_ID:
        raise ValueError(f"Host not found: {host_id}")
    return HOST_BY_ID[hid].copy()


def ping_host(host_id: Any) -> bool:
    hid = _to_host_id(host_id)
    return PING_BY_SCENARIO[mock_scenario()].get(hid, False)


def gpu_metrics(host_id: Any) -> dict[str, Any]:
    host = get_host_or_raise(host_id)
    if host["device_type"] != "GPU":
        return {"gpus": []}
    s = mock_scenario()
    if int(host["id"]) == 101:
        base = {"temp": 63, "mem": 52, "util": 71}
    else:
        base = {"temp": 87, "mem": 93, "util": 95} if s in {"warning", "degraded"} else {"temp": 66, "mem": 50, "util": 68}
    gpus = []
    for idx in range(8):
        gpus.append(
            {
                "index": idx,
                "name": "NVIDIA H100 SXM",
                "temperature_gpu": base["temp"] + (idx % 2),
                "memory_total_mb": 81920,
                "memory_used_mb": int(81920 * (base["mem"] / 100.0)),
                "memory_used_percent": base["mem"],
                "utilization_gpu_percent": base["util"],
                "utilization_memory_percent": min(100, base["mem"] + 2),
            }
        )
    return {"gpus": gpus}


def gpu_inspection(host_id: Any) -> dict[str, Any]:
    m = gpu_metrics(host_id)
    gpus = []
    ok = 0
    warning = 0
    error = 0
    for g in m["gpus"]:
        status = "ok"
        if g["temperature_gpu"] >= 85 or g["memory_used_percent"] >= 90:
            status = "warning"
            warning += 1
        else:
            ok += 1
        g2 = g.copy()
        g2["inspection_status"] = status
        gpus.append(g2)
    if mock_scenario() == "degraded" and gpus:
        gpus[-1]["inspection_status"] = "error"
        warning = max(0, warning - 1)
        error = 1
    summary = {"total": len(gpus), "ok": ok, "warning": warning, "error": error}
    return {"summary": summary, "gpus": gpus}


MOCK_DCGMI_TASKS: dict[str, dict[str, Any]] = {}
MOCK_IB_TASKS: dict[str, dict[str, Any]] = {}
MOCK_ETH_TASKS: dict[str, dict[str, Any]] = {}


def _now() -> datetime:
    return datetime.now()


def _task_id(prefix: str) -> str:
    return _now().strftime("%Y%m%d_%H%M%S") + f"_{prefix}_" + uuid.uuid4().hex[:6]


def _elapsed_sec(iso_ts: str) -> int:
    try:
        return int((_now() - datetime.fromisoformat(iso_ts)).total_seconds())
    except Exception:
        return 999


def _dcgmi_result_for_host(host: dict[str, Any], level: int) -> dict[str, Any]:
    scenario = mock_scenario()
    is_bad = scenario in {"warning", "degraded"} and int(host["id"]) == 102
    categories = [
        {
            "name": "Deployment",
            "tests": [
                {"name": "Software", "result": "Pass", "detail": ""},
                {"name": "Permissions and OS Blocks", "result": "Pass", "detail": ""},
            ],
        },
        {
            "name": "Hardware",
            "tests": [
                {"name": "PCIe", "result": "Warn" if is_bad else "Pass", "detail": "GPU 0" if is_bad else ""},
                {"name": "GPU Memory", "result": "Fail" if (is_bad and scenario == "degraded") else "Pass", "detail": "GPU 0" if is_bad else ""},
            ],
        },
    ]
    fail_count = 1 if (is_bad and scenario == "degraded") else 0
    warn_count = 1 if is_bad else 0
    return {
        "host_id": host["id"],
        "host_ip": host["host_ip"],
        "hostname": host["hostname"],
        "level": level,
        "categories": categories,
        "pass_count": 4 - fail_count - warn_count,
        "fail_count": fail_count,
        "warn_count": warn_count,
        "overall": "Fail" if fail_count else ("Warn" if warn_count else "Pass"),
        "raw_log": f"[MOCK] dcgmi diag -r {level} on {host['host_ip']}\n",
    }


def dcgmi_single(host_id: Any, level: int) -> dict[str, Any]:
    host = get_host_or_raise(host_id)
    return _dcgmi_result_for_host(host, level)


def dcgmi_batch_start(level: int) -> str:
    task_id = _task_id("dcgmi")
    gpu_hosts = [h for h in MOCK_HOSTS if h["device_type"] == "GPU"]
    results = [_dcgmi_result_for_host(h, level) for h in gpu_hosts]
    MOCK_DCGMI_TASKS[task_id] = {
        "task_id": task_id,
        "level": level,
        "status": "running",
        "started_at": _now().isoformat(),
        "finished_at": None,
        "total_hosts": len(results),
        "results": results,
        "raw_log": "\n".join([r["raw_log"] for r in results]),
    }
    return task_id


def dcgmi_batch_status(task_id: str) -> dict[str, Any] | None:
    task = MOCK_DCGMI_TASKS.get(task_id)
    if not task:
        return None
    elapsed = _elapsed_sec(task["started_at"])
    total = task["total_hosts"]
    if elapsed < 2:
        return {"task_id": task_id, "status": "running", "total_hosts": total, "completed_hosts": 0, "error": None}
    task["status"] = "completed"
    task["finished_at"] = task.get("finished_at") or _now().isoformat()
    return {"task_id": task_id, "status": "completed", "total_hosts": total, "completed_hosts": total, "error": None}


def dcgmi_summary(task_id: str) -> dict[str, Any] | None:
    return MOCK_DCGMI_TASKS.get(task_id)


def dcgmi_results_list() -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for t in MOCK_DCGMI_TASKS.values():
        out.append(
            {
                "task_id": t["task_id"],
                "level": t["level"],
                "status": t["status"],
                "started_at": t["started_at"],
                "total_hosts": t["total_hosts"],
                "pass_count": sum(1 for r in t["results"] if r["overall"] == "Pass"),
                "fail_count": sum(1 for r in t["results"] if r["overall"] in {"Fail", "Error"}),
            }
        )
    out.sort(key=lambda x: x["started_at"], reverse=True)
    return out


def ib_cards(host_id: Any) -> dict[str, Any]:
    _ = get_host_or_raise(host_id)
    return {
        "400G": [{"interface": "ib7s400p0", "lid": "0x1", "ca_type": "ConnectX-7", "state": "Active"}],
        "200G": [],
    }


def ib_single(test_type: str, bidirectional: bool = False) -> dict[str, Any]:
    if test_type == "bandwidth":
        pairs = [
            {
                "server_dev": "ib7s400p0",
                "client_dev": "ib7s400p0",
                "speed": "400G",
                "server_bw_gbps": 392.4 if not bidirectional else 781.0,
                "client_bw_gbps": 391.8 if not bidirectional else 779.5,
                "threshold_gbps": 380 if not bidirectional else 760,
                "passed": True,
            }
        ]
    else:
        pairs = [
            {
                "server_dev": "ib7s400p0",
                "client_dev": "ib7s400p0",
                "speed": "400G",
                "sizes": [
                    {"size_bytes": 64, "t_avg_us": 2.9, "threshold_us": 3.0, "passed": True},
                    {"size_bytes": 128, "t_avg_us": 3.2, "threshold_us": 3.0, "passed": False if mock_scenario() != "healthy" else True},
                    {"size_bytes": 256, "t_avg_us": 3.8, "threshold_us": 4.0, "passed": True},
                    {"size_bytes": 512, "t_avg_us": 4.2, "threshold_us": 4.0, "passed": False if mock_scenario() == "degraded" else True},
                ],
            }
        ]
    return {
        "test_type": test_type,
        "server_ip": "10.10.1.11",
        "client_ip": "10.10.1.12",
        "pairs": pairs,
        "raw_log": f"[MOCK] ib {test_type}",
    }


def ib_batch_start(test_type: str, bidirectional: bool = False) -> str:
    task_id = _task_id("ib")
    single = ib_single(test_type, bidirectional=bidirectional)
    result_item = {
        "server_ip": single["server_ip"],
        "client_ip": single["client_ip"],
        "pairs": single["pairs"],
    }
    pass_count = 0
    fail_count = 0
    if test_type == "bandwidth":
        for p in result_item["pairs"]:
            if p.get("passed"):
                pass_count += 1
            else:
                fail_count += 1
    else:
        for p in result_item["pairs"]:
            for sz in p.get("sizes", []):
                if sz.get("passed"):
                    pass_count += 1
                else:
                    fail_count += 1
    MOCK_IB_TASKS[task_id] = {
        "task_id": task_id,
        "test_type": test_type,
        "bidirectional": bidirectional,
        "status": "running",
        "started_at": _now().isoformat(),
        "finished_at": None,
        "total_pairs": 1,
        "results": [result_item],
        "pass_count": pass_count,
        "fail_count": fail_count,
        "raw_log": single.get("raw_log", ""),
    }
    return task_id


def ib_batch_status(task_id: str) -> dict[str, Any] | None:
    task = MOCK_IB_TASKS.get(task_id)
    if not task:
        return None
    elapsed = _elapsed_sec(task["started_at"])
    if elapsed < 2:
        return {"task_id": task_id, "status": "running", "total_pairs": 1, "completed_pairs": 0, "error": None}
    task["status"] = "completed"
    task["finished_at"] = task.get("finished_at") or _now().isoformat()
    return {"task_id": task_id, "status": "completed", "total_pairs": 1, "completed_pairs": 1, "error": None}


def ib_summary(task_id: str) -> dict[str, Any] | None:
    return MOCK_IB_TASKS.get(task_id)


def ib_results_list() -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for t in MOCK_IB_TASKS.values():
        out.append(
            {
                "task_id": t["task_id"],
                "test_type": t["test_type"],
                "status": t["status"],
                "started_at": t["started_at"],
                "pass_count": t["pass_count"],
                "fail_count": t["fail_count"],
            }
        )
    out.sort(key=lambda x: x["started_at"], reverse=True)
    return out


def eth_single(src_host_id: Any, dst_host_id: Any) -> dict[str, Any]:
    src = get_host_or_raise(src_host_id)
    dst = get_host_or_raise(dst_host_id)
    bw = "47.8 Gbits/sec"
    if mock_scenario() == "degraded":
        bw = "36.2 Gbits/sec"
    return {
        "src_host_id": src["id"],
        "dst_host_id": dst["id"],
        "src_ip": src["host_ip"],
        "dst_ip": dst["host_ip"],
        "src_hostname": src["hostname"],
        "dst_hostname": dst["hostname"],
        "bandwidth": bw,
        "passed": bw.startswith("47"),
        "raw_log": "[MOCK] iperf result",
    }


def eth_batch_start(mode: str) -> str:
    task_id = _task_id("eth")
    pairs = [eth_single(101, 201), eth_single(201, 102)]
    MOCK_ETH_TASKS[task_id] = {
        "task_id": task_id,
        "mode": mode,
        "status": "running",
        "started_at": _now().isoformat(),
        "finished_at": None,
        "cancel_requested": False,
        "total_pairs": len(pairs),
        "completed_pairs": 0,
        "results": pairs,
        "pass_count": sum(1 for p in pairs if p["passed"]),
        "fail_count": sum(1 for p in pairs if not p["passed"]),
        "raw_log": "\n".join([p["raw_log"] for p in pairs]),
    }
    return task_id


def eth_request_cancel(task_id: str) -> bool:
    task = MOCK_ETH_TASKS.get(task_id)
    if not task or task.get("status") != "running":
        return False
    task["cancel_requested"] = True
    return True


def eth_batch_status(task_id: str) -> dict[str, Any] | None:
    task = MOCK_ETH_TASKS.get(task_id)
    if not task:
        return None
    elapsed = _elapsed_sec(task["started_at"])
    total = task["total_pairs"]
    if task.get("cancel_requested"):
        task["status"] = "cancelled"
        done = 1 if elapsed >= 1 else 0
        task["completed_pairs"] = done
        return {
            "task_id": task_id,
            "status": "cancelled",
            "total_pairs": total,
            "completed_pairs": done,
            "started_at": task["started_at"],
            "current_pair": "",
            "current_phase": "已取消（Mock）",
            "cancel_requested": True,
            "error": None,
        }
    if elapsed < 2:
        task["completed_pairs"] = 0
        return {
            "task_id": task_id,
            "status": "running",
            "total_pairs": total,
            "completed_pairs": 0,
            "started_at": task["started_at"],
            "current_pair": "10.10.1.11 -> 10.10.2.21",
            "current_phase": "启动 iperf server（Mock）",
            "cancel_requested": False,
            "error": None,
        }
    if elapsed < 4:
        task["completed_pairs"] = 1
        return {
            "task_id": task_id,
            "status": "running",
            "total_pairs": total,
            "completed_pairs": 1,
            "started_at": task["started_at"],
            "current_pair": "10.10.2.21 -> 10.10.1.12",
            "current_phase": "执行带宽测试（Mock）",
            "cancel_requested": False,
            "error": None,
        }
    task["status"] = "completed"
    task["completed_pairs"] = total
    task["finished_at"] = task.get("finished_at") or _now().isoformat()
    return {
        "task_id": task_id,
        "status": "completed",
        "total_pairs": total,
        "completed_pairs": total,
        "started_at": task["started_at"],
        "current_pair": "",
        "current_phase": "",
        "cancel_requested": False,
        "error": None,
    }


def eth_summary(task_id: str) -> dict[str, Any] | None:
    task = MOCK_ETH_TASKS.get(task_id)
    if not task:
        return None
    if task.get("status") == "cancelled":
        done = task.get("completed_pairs", 0)
        task = task.copy()
        task["results"] = task["results"][:done]
    return task


def eth_results_list() -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for t in MOCK_ETH_TASKS.values():
        out.append(
            {
                "task_id": t["task_id"],
                "mode": t["mode"],
                "status": t["status"],
                "started_at": t["started_at"],
                "pass_count": t["pass_count"],
                "fail_count": t["fail_count"],
            }
        )
    out.sort(key=lambda x: x["started_at"], reverse=True)
    return out
