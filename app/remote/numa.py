"""
Remote GPU topology: run `nvidia-smi topo -m` on remote host,
parse the full topology matrix, Legend, NIC Legend, CPU/NUMA affinity.
"""

from __future__ import annotations

import re
from typing import Any

from app.ssh_runner import run_and_get_stdout, SSHRunnerError


def _parse_topo_matrix(stdout: str) -> dict[str, Any]:
    """Parse `nvidia-smi topo -m` output into structured data.

    Returns dict with:
      - headers: column device names (GPU0, GPU1, ..., NIC0, ...)
      - rows: list of row dicts with device, connections map, cpu_affinity, numa_affinity
      - legend: dict mapping abbreviation to description
      - nic_legend: dict mapping NIC label to device name
      - gpus: simplified list of GPU entries with numa/cpu info
    """
    lines = stdout.splitlines()
    result: dict[str, Any] = {
        "headers": [],
        "rows": [],
        "legend": {},
        "nic_legend": {},
        "gpus": [],
    }

    section = "matrix"
    header_cols: list[str] = []
    data_col_count = 0

    for line in lines:
        stripped = line.strip()

        if not stripped:
            continue

        if stripped.startswith("Legend:"):
            section = "legend"
            continue
        if stripped.startswith("NIC Legend:"):
            section = "nic_legend"
            continue

        if section == "legend":
            m = re.match(r"^(\S+)\s*=\s*(.+)", stripped)
            if m:
                result["legend"][m.group(1)] = m.group(2).strip()
            continue

        if section == "nic_legend":
            m = re.match(r"^(\S+):\s*(.+)", stripped)
            if m:
                result["nic_legend"][m.group(1)] = m.group(2).strip()
            continue

        if section == "matrix":
            parts = line.split()
            if not parts:
                continue

            if not header_cols:
                # Could be the header line — detect by checking if first
                # meaningful token looks like GPU0/NIC0/CPU/NUMA
                if any(p.startswith("GPU") or p.startswith("NIC") for p in parts):
                    # Header row: first token might be a tab/space leader,
                    # identify all device columns and trailing metadata columns
                    device_cols = []
                    for p in parts:
                        if p in ("CPU", "NUMA", "GPU"):
                            break
                        device_cols.append(p)
                    header_cols = device_cols
                    result["headers"] = list(header_cols)
                    data_col_count = len(header_cols)
                continue

            # Data row: first token is the device name (GPU0, NIC0, etc.)
            device_name = parts[0]
            if not (device_name.startswith("GPU") or device_name.startswith("NIC")):
                continue

            connections: dict[str, str] = {}
            for i, col_name in enumerate(header_cols):
                idx = i + 1
                if idx < len(parts):
                    connections[col_name] = parts[idx]

            # Trailing columns after device connections:
            #   CPU Affinity (e.g. "0-71,144-215"), NUMA Affinity (e.g. "0"),
            #   GPU NUMA ID (optional, e.g. "N/A")
            cpu_affinity = ""
            numa_affinity = ""

            remaining = parts[data_col_count + 1:]
            if len(remaining) >= 2:
                cpu_affinity = remaining[0]
                numa_affinity = remaining[1]
            elif len(remaining) == 1:
                numa_affinity = remaining[0]

            row_entry = {
                "device": device_name,
                "connections": connections,
                "cpu_affinity": cpu_affinity,
                "numa_affinity": numa_affinity,
            }
            result["rows"].append(row_entry)

            if device_name.startswith("GPU"):
                numa_val = None
                try:
                    numa_val = int(numa_affinity)
                except (ValueError, TypeError):
                    pass
                result["gpus"].append({
                    "device": device_name,
                    "cpu_affinity": cpu_affinity,
                    "numa_node": numa_val,
                })

    return result


def fetch_numa_topology(host_id: int | str, timeout: int = 30) -> dict[str, Any]:
    """SSH to host, run `nvidia-smi topo -m`, return parsed topology."""
    try:
        topo_out = run_and_get_stdout(
            host_id,
            "nvidia-smi topo -m 2>/dev/null || true",
            timeout=timeout,
        )
    except SSHRunnerError:
        raise

    if not topo_out.strip():
        return {
            "headers": [],
            "rows": [],
            "legend": {},
            "nic_legend": {},
            "gpus": [],
            "raw_unavailable": True,
        }

    data = _parse_topo_matrix(topo_out)
    data["raw_unavailable"] = False
    return data
