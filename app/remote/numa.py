"""
Remote NUMA topology: run numactl and nvidia-smi on remote host, parse and associate GPUs to NUMA nodes.
"""

from __future__ import annotations

import re
from typing import Any

from app.ssh_runner import run_and_get_stdout, SSHRunnerError


def _parse_numactl_hardware(stdout: str) -> dict[str, Any]:
    """Parse output of numactl -H into nodes (node_id, cpus, memory_mb, gpus)."""
    data: dict[str, Any] = {"nodes": [], "gpus": []}
    nodes_by_id: dict[int, dict[str, Any]] = {}
    for line in stdout.splitlines():
        line = line.strip()
        if not line or line.startswith("available:"):
            continue
        node_cpus = re.match(r"node (\d+) cpus:\s*(.*)", line)
        if node_cpus:
            node_id = int(node_cpus.group(1))
            cpus_str = node_cpus.group(2).strip()
            cpus = [int(x) for x in cpus_str.split() if x.isdigit()]
            if node_id not in nodes_by_id:
                nodes_by_id[node_id] = {"node_id": node_id, "cpus": [], "memory_mb": 0, "gpus": []}
            nodes_by_id[node_id]["cpus"] = cpus
            continue
        node_size = re.match(r"node (\d+) size:\s*(\d+)\s*MB", line)
        if node_size:
            node_id = int(node_size.group(1))
            size_mb = int(node_size.group(2))
            if node_id not in nodes_by_id:
                nodes_by_id[node_id] = {"node_id": node_id, "cpus": [], "memory_mb": 0, "gpus": []}
            nodes_by_id[node_id]["memory_mb"] = size_mb
    data["nodes"] = [nodes_by_id[n] for n in sorted(nodes_by_id)]
    if not data["nodes"]:
        data["nodes"] = [{"node_id": 0, "cpus": [], "memory_mb": 0, "gpus": []}]
    return data


def _parse_nvidia_smi_numa(stdout: str) -> list[dict[str, Any]]:
    """Parse nvidia-smi -q for GPU index and NUMA node. Returns list of {gpu_index, numa_node}."""
    gpus: list[dict[str, Any]] = []
    current: dict[str, Any] | None = None
    for line in stdout.splitlines():
        line = line.strip()
        if line.startswith("GPU "):
            if current is not None:
                gpus.append(current)
            current = {"gpu_index": len(gpus), "numa_node": None}
        elif "NUMA Node" in line and current is not None:
            try:
                current["numa_node"] = int(line.split(":")[-1].strip())
            except (ValueError, IndexError):
                pass
    if current is not None:
        gpus.append(current)
    return gpus


def fetch_numa_topology(host_id: int | str, timeout: int = 30) -> dict[str, Any]:
    """
    SSH to host, run numactl -H and nvidia-smi -q, return combined NUMA topology with GPU association.
    """
    try:
        numactl_out = run_and_get_stdout(host_id, "numactl -H 2>/dev/null || true", timeout=timeout)
    except SSHRunnerError:
        raise
    try:
        nvidia_out = run_and_get_stdout(
            host_id,
            "nvidia-smi -q 2>/dev/null || true",
            timeout=timeout,
        )
    except SSHRunnerError:
        raise
    data = _parse_numactl_hardware(numactl_out)
    gpu_numa = _parse_nvidia_smi_numa(nvidia_out)
    data["gpus"] = gpu_numa
    for node in data["nodes"]:
        node["gpus"] = [g["gpu_index"] for g in gpu_numa if g.get("numa_node") == node["node_id"]]
    return {
        "nodes": data["nodes"],
        "gpus": data["gpus"],
        "raw_numactl_unavailable": not numactl_out.strip(),
        "raw_nvidia_unavailable": not nvidia_out.strip(),
    }
