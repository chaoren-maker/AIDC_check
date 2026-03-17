"""
IB bandwidth and latency testing between two remote hosts.
Ported from ib-bench main.py — starts server/client via SSH, parses results.
"""

from __future__ import annotations

import logging
import time
from typing import Any

from app.host_store import resolve_host
from app.remote.ib_cards import discover_ib_cards
from app.remote.ib_config import (
    BANDWIDTH_THRESHOLDS,
    BASE_PORT,
    CMD_TIMEOUT,
    LATENCY_TEST_DURATION,
    LATENCY_TEST_SIZES,
    LATENCY_THRESHOLDS,
    LATENCY_MTU,
    SERVER_DURATION,
    SERVER_WAIT_TIME,
    TEST_COOLDOWN_TIME,
    TEST_DURATION,
)
from app.ssh_runner import SSHRunnerError, create_ssh_client

logger = logging.getLogger(__name__)

CHANNEL_READ_TIMEOUT = CMD_TIMEOUT + 10


def _read_with_timeout(channel_file, timeout_sec: int = CHANNEL_READ_TIMEOUT) -> str:
    """Read SSH channel stdout with a timeout to prevent infinite blocking."""
    channel_file.channel.settimeout(timeout_sec)
    try:
        return channel_file.read().decode("utf-8", errors="ignore")
    except Exception:
        return "(read timed out)\n"


# ---------------------------------------------------------------------------
# Output parsers
# ---------------------------------------------------------------------------

def parse_bw_output(stdout: str) -> float | None:
    """Extract BW average (Gb/sec) from ib_write_bw output.

    The summary line contains numeric columns; BW avg is the 4th field.
    """
    for line in stdout.splitlines():
        stripped = line.strip()
        if not stripped or not stripped[0].isdigit():
            continue
        parts = stripped.split()
        if len(parts) >= 4:
            try:
                return float(parts[3])
            except ValueError:
                continue
    return None


def parse_latency_output(stdout: str) -> float | None:
    """Extract average latency (μs) from ib_write_lat output.

    The data line starts with a digit; t_avg is the 3rd field.
    """
    for line in stdout.splitlines():
        stripped = line.strip()
        if not stripped or not stripped[0].isdigit():
            continue
        parts = stripped.split()
        if len(parts) >= 3:
            try:
                return float(parts[2])
            except ValueError:
                continue
    return None


# ---------------------------------------------------------------------------
# PASS/FAIL evaluation
# ---------------------------------------------------------------------------

def evaluate_bw(bw_gbps: float, speed: int, bidirectional: bool) -> tuple[bool, float]:
    mode = "bidirectional" if bidirectional else "unidirectional"
    threshold = BANDWIDTH_THRESHOLDS[mode].get(speed, 190)
    return bw_gbps >= threshold, threshold


def evaluate_latency(size: int, t_avg: float) -> tuple[bool, float]:
    threshold = LATENCY_THRESHOLDS.get(size, 4.0)
    return t_avg < threshold, threshold


# ---------------------------------------------------------------------------
# Card pairing
# ---------------------------------------------------------------------------

def _pair_cards(
    server_cards: dict[str, list[dict]],
    client_cards: dict[str, list[dict]],
) -> list[dict[str, Any]]:
    """Match server/client IB cards by speed group and index."""
    pairs: list[dict[str, Any]] = []
    for speed_key in ("400G", "200G"):
        s_list = server_cards.get(speed_key, [])
        c_list = client_cards.get(speed_key, [])
        count = min(len(s_list), len(c_list))
        speed_val = int(speed_key.replace("G", ""))
        for i in range(count):
            pairs.append({
                "index": len(pairs),
                "server_dev": s_list[i]["interface"],
                "client_dev": c_list[i]["interface"],
                "speed": speed_val,
                "speed_label": speed_key,
                "port": BASE_PORT + len(pairs),
            })
    return pairs


# ---------------------------------------------------------------------------
# Bandwidth test
# ---------------------------------------------------------------------------

def _filter_pairs(
    pairs: list[dict[str, Any]],
    server_dev: str | None,
    client_dev: str | None,
) -> list[dict[str, Any]]:
    """Filter auto-paired cards when user specifies a device."""
    if not server_dev and not client_dev:
        return pairs
    filtered = []
    for p in pairs:
        if server_dev and p["server_dev"] != server_dev:
            continue
        if client_dev and p["client_dev"] != client_dev:
            continue
        filtered.append(p)
    return filtered


def run_bandwidth_test(
    server_id: int | str,
    client_id: int | str,
    bidirectional: bool = False,
    server_dev: str | None = None,
    client_dev: str | None = None,
) -> dict[str, Any]:
    """Run ib_write_bw between two hosts, return per-card results."""
    server_host = resolve_host(server_id)
    client_host = resolve_host(client_id)
    if not server_host:
        raise SSHRunnerError(f"Server host not found: {server_id}")
    if not client_host:
        raise SSHRunnerError(f"Client host not found: {client_id}")

    server_ip = server_host["host_ip"]
    client_ip = client_host["host_ip"]

    server_cards = discover_ib_cards(server_id)
    client_cards = discover_ib_cards(client_id)
    pairs = _filter_pairs(_pair_cards(server_cards, client_cards), server_dev, client_dev)

    if not pairs:
        return {
            "server_ip": server_ip,
            "client_ip": client_ip,
            "test_type": "bandwidth",
            "bidirectional": bidirectional,
            "pairs": [],
            "raw_log": "No matching IB card pairs found.\n",
        }

    bi_flag = "--bidirectional " if bidirectional else ""
    raw_log_parts: list[str] = []
    results: list[dict[str, Any]] = []

    server_ssh = create_ssh_client(server_host)
    try:
        server_channels: list[dict] = []
        for p in pairs:
            cmd = (
                f"timeout {CMD_TIMEOUT} ib_write_bw {bi_flag}--ib-dev={p['server_dev']} "
                f"-p {p['port']} -D {SERVER_DURATION} -q 4 --report_gbits -F"
            )
            _, stdout, stderr = server_ssh.exec_command(cmd)
            server_channels.append({"pair": p, "stdout": stdout, "stderr": stderr})

        time.sleep(SERVER_WAIT_TIME)

        client_ssh = create_ssh_client(client_host)
        try:
            client_channels: list[dict] = []
            for p in pairs:
                cmd = (
                    f"timeout {CMD_TIMEOUT} ib_write_bw {bi_flag}--ib-dev={p['client_dev']} {server_ip} "
                    f"-p {p['port']} -D {TEST_DURATION} -q 4 --report_gbits -F"
                )
                _, stdout, stderr = client_ssh.exec_command(cmd)
                client_channels.append({"pair": p, "stdout": stdout, "stderr": stderr})

            for s_ch, c_ch in zip(server_channels, client_channels):
                p = s_ch["pair"]
                server_out = _read_with_timeout(s_ch["stdout"])
                client_out = _read_with_timeout(c_ch["stdout"])

                server_bw = parse_bw_output(server_out)
                client_bw = parse_bw_output(client_out)

                passed = False
                if server_bw is not None and client_bw is not None:
                    s_pass, threshold = evaluate_bw(server_bw, p["speed"], bidirectional)
                    c_pass, _ = evaluate_bw(client_bw, p["speed"], bidirectional)
                    passed = s_pass and c_pass
                else:
                    threshold = BANDWIDTH_THRESHOLDS[
                        "bidirectional" if bidirectional else "unidirectional"
                    ].get(p["speed"], 190)

                results.append({
                    "server_dev": p["server_dev"],
                    "client_dev": p["client_dev"],
                    "speed": p["speed_label"],
                    "server_bw_gbps": server_bw,
                    "client_bw_gbps": client_bw,
                    "threshold_gbps": threshold,
                    "passed": passed,
                })

                combo = f"{server_ip}:{p['server_dev']}&{client_ip}:{p['client_dev']}"
                raw_log_parts.append(
                    f"Test: {combo}\n"
                    f"Server Output:\n{server_out}\n"
                    f"Client Output:\n{client_out}\n"
                    f"{'-' * 50}\n"
                )

            time.sleep(TEST_COOLDOWN_TIME)
        finally:
            client_ssh.close()
    finally:
        server_ssh.close()

    return {
        "server_ip": server_ip,
        "client_ip": client_ip,
        "test_type": "bandwidth",
        "bidirectional": bidirectional,
        "pairs": results,
        "raw_log": "".join(raw_log_parts),
    }


# ---------------------------------------------------------------------------
# Latency test
# ---------------------------------------------------------------------------

def run_latency_test(
    server_id: int | str,
    client_id: int | str,
    server_dev: str | None = None,
    client_dev: str | None = None,
) -> dict[str, Any]:
    """Run ib_write_lat between two hosts for multiple message sizes."""
    server_host = resolve_host(server_id)
    client_host = resolve_host(client_id)
    if not server_host:
        raise SSHRunnerError(f"Server host not found: {server_id}")
    if not client_host:
        raise SSHRunnerError(f"Client host not found: {client_id}")

    server_ip = server_host["host_ip"]
    client_ip = client_host["host_ip"]

    server_cards = discover_ib_cards(server_id)
    client_cards = discover_ib_cards(client_id)
    pairs = _filter_pairs(_pair_cards(server_cards, client_cards), server_dev, client_dev)

    if not pairs:
        return {
            "server_ip": server_ip,
            "client_ip": client_ip,
            "test_type": "latency",
            "pairs": [],
            "raw_log": "No matching IB card pairs found.\n",
        }

    raw_log_parts: list[str] = []
    card_results: list[dict[str, Any]] = []

    server_ssh = create_ssh_client(server_host)
    client_ssh = create_ssh_client(client_host)
    try:
        for p in pairs:
            size_results: list[dict[str, Any]] = []
            all_pass = True

            for size in LATENCY_TEST_SIZES:
                lat_cmd_timeout = LATENCY_TEST_DURATION + 15
                s_cmd = (
                    f"timeout {lat_cmd_timeout} "
                    f"ib_write_lat -d {p['server_dev']} -p {p['port']} "
                    f"-m {LATENCY_MTU} -s {size} -F -D {LATENCY_TEST_DURATION} --cpu_util"
                )
                c_cmd = (
                    f"timeout {lat_cmd_timeout} "
                    f"ib_write_lat {server_ip} -d {p['client_dev']} -p {p['port']} "
                    f"-m {LATENCY_MTU} -s {size} -F -D {LATENCY_TEST_DURATION} --cpu_util"
                )

                _, s_stdout, _ = server_ssh.exec_command(s_cmd)
                time.sleep(SERVER_WAIT_TIME)
                _, c_stdout, _ = client_ssh.exec_command(c_cmd)

                c_out = _read_with_timeout(c_stdout, lat_cmd_timeout + 10)
                s_out = _read_with_timeout(s_stdout, lat_cmd_timeout + 10)

                t_avg = parse_latency_output(c_out)
                passed = False
                threshold = LATENCY_THRESHOLDS.get(size, 4.0)
                if t_avg is not None:
                    passed, threshold = evaluate_latency(size, t_avg)
                if not passed:
                    all_pass = False

                size_results.append({
                    "size_bytes": size,
                    "t_avg_us": t_avg,
                    "threshold_us": threshold,
                    "passed": passed,
                })

                combo = f"{server_ip}:{p['server_dev']}&{client_ip}:{p['client_dev']}"
                raw_log_parts.append(
                    f"Test: {combo}\nSize: {size}B\n"
                    f"Server Output:\n{s_out}\n"
                    f"Client Output:\n{c_out}\n"
                    f"{'-' * 50}\n"
                )

                time.sleep(TEST_COOLDOWN_TIME)

            card_results.append({
                "server_dev": p["server_dev"],
                "client_dev": p["client_dev"],
                "speed": p["speed_label"],
                "sizes": size_results,
                "passed": all_pass,
            })
    finally:
        client_ssh.close()
        server_ssh.close()

    return {
        "server_ip": server_ip,
        "client_ip": client_ip,
        "test_type": "latency",
        "pairs": card_results,
        "raw_log": "".join(raw_log_parts),
    }
