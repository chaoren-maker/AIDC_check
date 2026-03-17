"""
InfiniBand card discovery via SSH.
Ported from ib-bench netcard.py — runs `mst status -vv` and `ibstat` on remote
host, filters VF/onboard cards, returns 200G/400G card lists.
"""

from __future__ import annotations

import re
from typing import Any

from app.host_store import resolve_host
from app.ssh_runner import SSHRunnerError, create_ssh_client


def _parse_mst_output(mst_output: str) -> tuple[set[str], set[str], set[str]]:
    """Parse `mst status -vv` output.

    Returns (physical_netcards, virtual_netcards, onboard_netcards).
    """
    physical: set[str] = set()
    virtual: set[str] = set()
    onboard: set[str] = set()

    for line in mst_output.splitlines():
        if not line.strip() or "DEVICE_TYPE" in line or "MST modules" in line or "---" in line:
            continue
        parts = line.split()
        if len(parts) < 4:
            continue
        device_type = parts[0]
        rdma_device = None
        for part in parts:
            if re.match(r"mlx5_\d+", part):
                rdma_device = part
                break
        if not rdma_device:
            continue
        if device_type.startswith("ConnectX") or device_type.startswith("BlueField"):
            physical.add(rdma_device)
            if re.search(r"\d{4}:01:00\.\d", line):
                for part in parts:
                    if re.match(r"ib\d+s\d+p\d+", part):
                        onboard.add(part)
                        break
        elif device_type == "NA":
            virtual.add(rdma_device)

    return physical, virtual, onboard


def _parse_ibstat(
    ibstat_output: str,
    physical_netcards: set[str],
    virtual_netcards: set[str],
    onboard_netcards: set[str],
) -> dict[str, list[dict[str, Any]]]:
    """Parse `ibstat` output and return grouped cards."""
    cards_200g: list[dict[str, Any]] = []
    cards_400g: list[dict[str, Any]] = []

    interface_name = ""
    ca_type = ""
    rate = 0
    port_state = ""

    PF_CA_TYPES = {"MT4123", "MT4119", "MT4121", "MT4125"}

    for line in ibstat_output.splitlines():
        ca_match = re.match(r"^CA '(.*?)'", line)
        if ca_match:
            interface_name = ca_match.group(1)
            ca_type = ""
            continue

        if "CA type:" in line:
            ca_type = line.split(":")[1].strip()
        elif "State:" in line and "Physical" not in line:
            port_state = line.split(":")[1].strip()
        elif "Rate" in line:
            try:
                rate = int(line.split(":")[1].strip())
            except ValueError:
                rate = 0
        elif "Base lid" in line:
            try:
                lid = line.split(":")[1].strip()
            except (IndexError, ValueError):
                lid = "0"

            if interface_name in onboard_netcards:
                continue

            card_entry = {
                "interface": interface_name,
                "lid": lid,
                "ca_type": ca_type,
                "state": port_state,
            }

            if rate == 200:
                is_virtual = ca_type == "MT4124" or interface_name in virtual_netcards
                if is_virtual:
                    continue
                cards_200g.append(card_entry)
            elif rate == 400:
                cards_400g.append(card_entry)

    return {"200G": cards_200g, "400G": cards_400g}


def discover_ib_cards(host_id: int | str) -> dict[str, Any]:
    """Discover IB cards on a remote host.

    Returns::
        {
            "host_ip": str,
            "200G": [{"interface": str, "lid": str, "ca_type": str, "state": str}, ...],
            "400G": [...],
        }
    """
    host = resolve_host(host_id)
    if not host:
        raise SSHRunnerError(f"Host not found: {host_id}")

    ssh = create_ssh_client(host)
    try:
        _, mst_stdout, _ = ssh.exec_command("mst status -vv 2>/dev/null || true", timeout=30)
        mst_output = mst_stdout.read().decode("utf-8", errors="replace")

        _, ib_stdout, _ = ssh.exec_command("ibstat", timeout=30)
        ibstat_output = ib_stdout.read().decode("utf-8", errors="replace")
    finally:
        ssh.close()

    physical, virtual, onboard = _parse_mst_output(mst_output)
    cards = _parse_ibstat(ibstat_output, physical, virtual, onboard)

    return {
        "host_ip": host["host_ip"],
        **cards,
    }
