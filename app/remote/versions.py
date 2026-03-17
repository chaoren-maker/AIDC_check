"""
Remote GPU, NIC, and server/OS version collection via SSH.
"""

from __future__ import annotations

import re
from typing import Any

from app.ssh_runner import run_and_get_stdout, run_remote_commands, SSHRunnerError


def fetch_gpu_versions(host_id: int | str, timeout: int = 30) -> dict[str, Any]:
    """Run nvidia-smi --query on remote and return driver + per-GPU firmware/VBIOS."""
    try:
        out = run_and_get_stdout(
            host_id,
            "nvidia-smi --query-gpu=driver_version,vbios_version,name --format=csv,noheader,nounits 2>/dev/null || nvidia-smi -q 2>/dev/null || true",
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
        if len(parts) >= 2:
            gpus.append({
                "driver_version": parts[0],
                "vbios_version": parts[1] if len(parts) > 1 else "",
                "name": parts[2] if len(parts) > 2 else "",
            })
        else:
            gpus.append({"driver_version": line, "vbios_version": "", "name": ""})
    driver_ver = ""
    if out.strip():
        m = re.search(r"Driver Version:\s*(\S+)", out)
        if m:
            driver_ver = m.group(1)
    return {"driver_version": driver_ver or (gpus[0]["driver_version"] if gpus else ""), "gpus": gpus}


def fetch_nic_firmware(host_id: int | str, timeout: int = 30) -> list[dict[str, Any]]:
    """Run lspci on remote and return NIC list; firmware where obtainable."""
    try:
        out = run_and_get_stdout(host_id, "lspci -v 2>/dev/null | head -500 || true", timeout=timeout)
    except SSHRunnerError:
        raise
    nics: list[dict[str, Any]] = []
    current: dict[str, Any] | None = None
    for line in out.splitlines():
        if re.match(r"^\w\w:\w\w\.\w", line):
            if current:
                nics.append(current)
            current = {"device": line.strip(), "firmware_version": None, "subsystem": None}
        elif current is not None and "Subsystem:" in line:
            current["subsystem"] = line.split(":", 1)[-1].strip()
        elif current is not None and ("Firmware" in line or "firmware" in line):
            current["firmware_version"] = line.split(":", 1)[-1].strip()
    if current:
        nics.append(current)
    return nics


def fetch_server_os_version(host_id: int | str, timeout: int = 30) -> dict[str, Any]:
    """Run uname and /etc/os-release in a single command."""
    try:
        out = run_and_get_stdout(
            host_id,
            "echo '---UNAME---' && uname -r 2>/dev/null && echo '---OSRELEASE---' && cat /etc/os-release 2>/dev/null || true",
            timeout=timeout,
        )
    except SSHRunnerError:
        raise
    kernel = ""
    distro = ""
    version = ""
    section = ""
    for line in out.splitlines():
        if "---UNAME---" in line:
            section = "uname"
            continue
        if "---OSRELEASE---" in line:
            section = "osrelease"
            continue
        if section == "uname" and line.strip():
            kernel = line.strip()
        elif section == "osrelease":
            if line.startswith("PRETTY_NAME="):
                distro = line.split("=", 1)[-1].strip('"')
            elif line.startswith("VERSION_ID="):
                version = line.split("=", 1)[-1].strip('"')
    return {"kernel": kernel, "distro": distro, "version_id": version}


def fetch_all_versions(host_id: int | str, timeout: int = 30) -> dict[str, Any]:
    """Fetch GPU, NIC, and server versions in a single SSH session (3 commands, 1 connection)."""
    cmds = [
        "nvidia-smi --query-gpu=driver_version,vbios_version,name --format=csv,noheader,nounits 2>/dev/null || true",
        "lspci -v 2>/dev/null | head -500 || true",
        "echo '---UNAME---' && uname -r 2>/dev/null && echo '---OSRELEASE---' && cat /etc/os-release 2>/dev/null || true",
    ]
    try:
        results = run_remote_commands(host_id, cmds, timeout=timeout)
    except SSHRunnerError:
        raise

    gpu_out = results[cmds[0]][0]
    nic_out = results[cmds[1]][0]
    srv_out = results[cmds[2]][0]

    # Parse GPU
    gpus: list[dict[str, Any]] = []
    driver_ver = ""
    for line in gpu_out.strip().splitlines():
        line = line.strip()
        if not line:
            continue
        parts = [p.strip() for p in line.split(",")]
        if len(parts) >= 2:
            gpus.append({
                "driver_version": parts[0],
                "vbios_version": parts[1] if len(parts) > 1 else "",
                "name": parts[2] if len(parts) > 2 else "",
            })
        else:
            gpus.append({"driver_version": line, "vbios_version": "", "name": ""})
    m = re.search(r"Driver Version:\s*(\S+)", gpu_out)
    if m:
        driver_ver = m.group(1)

    # Parse NIC
    nics: list[dict[str, Any]] = []
    current: dict[str, Any] | None = None
    for line in nic_out.splitlines():
        if re.match(r"^\w\w:\w\w\.\w", line):
            if current:
                nics.append(current)
            current = {"device": line.strip(), "firmware_version": None, "subsystem": None}
        elif current is not None and "Subsystem:" in line:
            current["subsystem"] = line.split(":", 1)[-1].strip()
        elif current is not None and ("Firmware" in line or "firmware" in line):
            current["firmware_version"] = line.split(":", 1)[-1].strip()
    if current:
        nics.append(current)

    # Parse server/OS
    kernel = ""
    distro = ""
    version_id = ""
    section = ""
    for line in srv_out.splitlines():
        if "---UNAME---" in line:
            section = "uname"
            continue
        if "---OSRELEASE---" in line:
            section = "osrelease"
            continue
        if section == "uname" and line.strip():
            kernel = line.strip()
        elif section == "osrelease":
            if line.startswith("PRETTY_NAME="):
                distro = line.split("=", 1)[-1].strip('"')
            elif line.startswith("VERSION_ID="):
                version_id = line.split("=", 1)[-1].strip('"')

    return {
        "gpu": {
            "driver_version": driver_ver or (gpus[0]["driver_version"] if gpus else ""),
            "gpus": gpus,
        },
        "nics": nics,
        "server": {"kernel": kernel, "distro": distro, "version_id": version_id},
    }
