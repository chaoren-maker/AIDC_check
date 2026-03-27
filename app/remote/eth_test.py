"""
Ethernet bandwidth test using iperf — supports single-pair and batch modes.

Workflow per test pair:
  1. Start iperf server on destination host (`iperf -s -D`)
  2. Run iperf client from source host (`iperf -c <dst> -P 20 -t 10`)
  3. Parse [SUM] line to extract aggregate bandwidth
  4. Stop iperf server on destination host
  5. Auto-retest if bandwidth < threshold

Batch mode runs in a background thread with progress tracking.
"""

from __future__ import annotations

import logging
import threading
import time
import uuid
from datetime import datetime
from typing import Any

from app.host_store import get_hosts_safe, resolve_host
from app.ssh_runner import SSHRunnerError, create_ssh_client

logger = logging.getLogger(__name__)

IPERF_PARALLEL = 20
IPERF_DURATION = 10
SSH_TIMEOUT = 30
CMD_TIMEOUT = 60
BANDWIDTH_THRESHOLD_GBPS = 46.0
DEFAULT_MAX_CONCURRENT = 4

_batch_tasks: dict[str, dict[str, Any]] = {}


def _ssh_exec(host: dict, command: str, timeout: int = CMD_TIMEOUT) -> tuple[str, str]:
    """Execute a command on a remote host via SSH, return (stdout, stderr)."""
    client = create_ssh_client(host, timeout=SSH_TIMEOUT)
    try:
        stdin, stdout, stderr = client.exec_command(command, timeout=timeout)
        stdout.channel.settimeout(timeout)
        out = stdout.read().decode("utf-8", errors="replace")
        err = stderr.read().decode("utf-8", errors="replace")
        return out, err
    finally:
        client.close()


def start_iperf_server(host: dict, retries: int = 3) -> bool:
    """Start iperf server in daemon mode and verify it's running."""
    stop_iperf_server(host)
    time.sleep(1)

    for attempt in range(retries):
        try:
            _ssh_exec(host, "iperf -s -D", timeout=10)
            time.sleep(2)
            out, _ = _ssh_exec(host, "pgrep -x iperf", timeout=10)
            if out.strip():
                return True
        except Exception as exc:
            logger.warning("iperf server start attempt %d failed on %s: %s",
                           attempt + 1, host["host_ip"], exc)
        time.sleep(2)

    logger.error("Failed to start iperf server on %s after %d attempts",
                 host["host_ip"], retries)
    return False


def stop_iperf_server(host: dict) -> None:
    """Stop any running iperf processes on the host."""
    try:
        _ssh_exec(host, "pkill iperf 2>/dev/null || true", timeout=10)
    except Exception:
        pass


def parse_iperf_output(output: str) -> dict[str, Any]:
    """Parse iperf output and extract the [SUM] bandwidth.

    Returns dict with keys: bandwidth_value, bandwidth_unit, bandwidth_display, reliable.
    """
    result: dict[str, Any] = {
        "bandwidth_value": 0.0,
        "bandwidth_unit": "",
        "bandwidth_display": "Unknown",
        "reliable": True,
    }

    for line in output.splitlines():
        if "[SUM]" not in line or "bits/sec" not in line:
            continue

        parts = line.split()
        if len(parts) < 7:
            continue

        try:
            bw_val = float(parts[5])
            bw_unit = parts[6]
            result["bandwidth_value"] = bw_val
            result["bandwidth_unit"] = bw_unit

            time_range = parts[1].split("-")
            if len(time_range) == 2:
                duration = float(time_range[1]) - float(time_range[0])
                if duration < 1.0:
                    result["reliable"] = False
                    result["bandwidth_display"] = f"{bw_val} {bw_unit} (测试时间仅{duration:.1f}s，可能不准确)"
                else:
                    result["bandwidth_display"] = f"{bw_val} {bw_unit}"
            else:
                result["bandwidth_display"] = f"{bw_val} {bw_unit}"
        except (ValueError, IndexError):
            result["bandwidth_display"] = f"{parts[5]} {parts[6]}"

        break

    return result


def _normalise_bw_gbps(value: float, unit: str) -> float:
    """Convert bandwidth to Gbits/sec for threshold comparison."""
    u = unit.lower()
    if "gbit" in u:
        return value
    if "mbit" in u:
        return value / 1000.0
    if "kbit" in u:
        return value / 1_000_000.0
    return value


def run_single_pair(
    src_host_id: int | str,
    dst_host_id: int | str,
) -> dict[str, Any]:
    """Run iperf test between two hosts. Returns structured result."""
    src = resolve_host(src_host_id)
    dst = resolve_host(dst_host_id)
    if not src:
        raise ValueError(f"Source host not found: {src_host_id}")
    if not dst:
        raise ValueError(f"Destination host not found: {dst_host_id}")

    src_ip = src["host_ip"]
    dst_ip = dst["host_ip"]
    raw_log_parts: list[str] = []

    result: dict[str, Any] = {
        "src_ip": src_ip,
        "dst_ip": dst_ip,
        "src_hostname": src.get("hostname", ""),
        "dst_hostname": dst.get("hostname", ""),
        "bandwidth": "Unknown",
        "bandwidth_gbps": 0.0,
        "passed": False,
        "error": None,
        "raw_log": "",
    }

    try:
        if not start_iperf_server(dst):
            result["error"] = f"无法在 {dst_ip} 上启动 iperf 服务"
            return result

        cmd = f"iperf -c {dst_ip} -P {IPERF_PARALLEL} -t {IPERF_DURATION}"
        max_retries = 2

        for retry in range(max_retries + 1):
            try:
                out, err = _ssh_exec(src, cmd, timeout=CMD_TIMEOUT)
                raw_log_parts.append(f"=== {src_ip} -> {dst_ip} (attempt {retry + 1}) ===\n")
                raw_log_parts.append(out)
                if err:
                    raw_log_parts.append(f"STDERR: {err}\n")

                if "Connection reset by peer" in err and retry < max_retries:
                    time.sleep(5)
                    continue

                parsed = parse_iperf_output(out)

                if (not parsed["reliable"] or parsed["bandwidth_display"] == "Unknown") and retry < max_retries:
                    time.sleep(5)
                    continue

                result["bandwidth"] = parsed["bandwidth_display"]
                bw_gbps = _normalise_bw_gbps(parsed["bandwidth_value"], parsed["bandwidth_unit"])
                result["bandwidth_gbps"] = round(bw_gbps, 2)
                result["passed"] = bw_gbps >= BANDWIDTH_THRESHOLD_GBPS
                break

            except SSHRunnerError as exc:
                raw_log_parts.append(f"SSH Error (attempt {retry + 1}): {exc}\n")
                if retry < max_retries:
                    time.sleep(5)
                else:
                    result["error"] = str(exc)

    except Exception as exc:
        result["error"] = str(exc)
    finally:
        stop_iperf_server(dst)
        result["raw_log"] = "\n".join(raw_log_parts)

    return result


def run_eth_batch(
    mode: str = "fullmesh",
    max_concurrent: int = DEFAULT_MAX_CONCURRENT,
) -> str:
    """Start batch Ethernet bandwidth test on all GPU/CPU hosts.

    mode: "fullmesh" — test all pairs; "sequential" — test in order (A→B, B→C, ...)
    Returns task_id immediately; test runs in a background thread.
    """
    hosts = get_hosts_safe()
    eth_hosts = [h for h in hosts if h.get("device_type", "GPU") in ("GPU", "CPU")]
    if len(eth_hosts) < 2:
        raise ValueError("至少需要 2 台 GPU/CPU 主机才能进行以太网测试")

    if mode == "fullmesh":
        pairs = [(s, d) for s in eth_hosts for d in eth_hosts if s["id"] != d["id"]]
    else:
        pairs = [(eth_hosts[i], eth_hosts[i + 1]) for i in range(len(eth_hosts) - 1)]

    task_id = datetime.now().strftime("%Y%m%d_%H%M%S") + "_eth_" + uuid.uuid4().hex[:6]
    task_record: dict[str, Any] = {
        "task_id": task_id,
        "mode": mode,
        "status": "running",
        "started_at": datetime.now().isoformat(),
        "total_pairs": len(pairs),
        "completed_pairs": 0,
        "results": [],
        "raw_log": "",
        "error": None,
        "cancel_requested": False,
        "current_pair": "",
        "current_phase": "准备中",
    }
    _batch_tasks[task_id] = task_record

    def _execute():
        try:
            all_results: list[dict] = []
            all_raw_log: list[str] = []

            for _idx, (src, dst) in enumerate(pairs):
                if task_record.get("cancel_requested"):
                    task_record["results"] = all_results
                    task_record["raw_log"] = "\n".join(all_raw_log)
                    task_record["status"] = "cancelled"
                    task_record["error"] = "用户已停止（已保存已完成的对）"
                    task_record["current_pair"] = ""
                    task_record["current_phase"] = "已停止"
                    task_record["finished_at"] = datetime.now().isoformat()
                    from app.eth_results_store import save_result
                    save_result(task_record)
                    return

                src_ip = src.get("host_ip", "")
                dst_ip = dst.get("host_ip", "")
                task_record["current_pair"] = f"{src_ip} → {dst_ip}"
                task_record["current_phase"] = "iperf 测试中（单对约 10~60 秒，含重试与清理）"
                r = run_single_pair(src["id"], dst["id"])
                all_results.append(r)
                all_raw_log.append(r.get("raw_log", ""))
                task_record["completed_pairs"] += 1
                task_record["current_phase"] = "本对已完成，等待间隔后进入下一对"

                time.sleep(3)

            task_record["results"] = all_results
            task_record["raw_log"] = "\n".join(all_raw_log)
            task_record["status"] = "completed"
            task_record["current_pair"] = ""
            task_record["current_phase"] = "全部完成"
            task_record["finished_at"] = datetime.now().isoformat()

            from app.eth_results_store import save_result
            save_result(task_record)

        except Exception as exc:
            logger.exception("Ethernet batch test failed")
            task_record["status"] = "failed"
            task_record["error"] = str(exc)
            task_record["finished_at"] = datetime.now().isoformat()
            task_record["current_pair"] = ""
            task_record["current_phase"] = "失败"

    t = threading.Thread(target=_execute, daemon=True)
    t.start()

    return task_id


def get_batch_task(task_id: str) -> dict[str, Any] | None:
    """Return in-memory task record, or None if not found / already finished."""
    return _batch_tasks.get(task_id)


def request_cancel_batch(task_id: str) -> bool:
    """Request cancellation of a running batch. Checked between pairs only."""
    task = _batch_tasks.get(task_id)
    if not task or task.get("status") != "running":
        return False
    task["cancel_requested"] = True
    task["current_phase"] = "收到停止请求，将在当前对结束后停止…"
    return True
