"""ICMP ping helper.

This module provides a small cross-platform wrapper around the system `ping`
command, designed for lightweight reachability checks without SSH overhead.
"""

from __future__ import annotations

import asyncio
import platform


async def ping_host(host: str, timeout_s: float = 1.5, count: int = 1) -> bool:
    """Ping a host once to check basic reachability.

    Args:
        host: IP or hostname.
        timeout_s: Overall timeout in seconds.
        count: Number of echo requests (default: 1).

    Returns:
        True if ping succeeds (exit code 0), otherwise False.
    """
    system = platform.system().lower()
    count = max(1, int(count))
    timeout_s = max(0.2, float(timeout_s))

    if system == "darwin":
        # macOS: -W is per-packet timeout in milliseconds.
        per_packet_ms = max(200, int(timeout_s * 1000))
        args = ["ping", "-n", "-q", "-c", str(count), "-W", str(per_packet_ms), host]
    else:
        # Linux: -W is per-packet timeout in seconds (integer).
        per_packet_s = max(1, int(timeout_s))
        args = ["ping", "-n", "-q", "-c", str(count), "-W", str(per_packet_s), host]

    try:
        proc = await asyncio.create_subprocess_exec(
            *args,
            stdout=asyncio.subprocess.DEVNULL,
            stderr=asyncio.subprocess.DEVNULL,
        )
        await asyncio.wait_for(proc.communicate(), timeout=timeout_s + 0.5)
        return proc.returncode == 0
    except Exception:
        return False
