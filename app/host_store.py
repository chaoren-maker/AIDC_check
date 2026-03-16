"""
In-memory store for loaded GPU host list.
List API responses must not include passwords.
"""

from __future__ import annotations

from typing import Any

# Global in-memory list of hosts. Each entry: id, host_ip, username, password, ssh_port, remark.
_hosts: list[dict[str, Any]] = []


def replace_hosts(hosts: list[dict[str, Any]]) -> None:
    """Replace the current host list with the given list (each must have id, host_ip, username, password, ssh_port, remark)."""
    global _hosts
    _hosts = list(hosts)


def get_hosts_safe() -> list[dict[str, Any]]:
    """Return current host list for API: id, host_ip, username, ssh_port, remark (no password)."""
    return [
        {
            "id": h["id"],
            "host_ip": h["host_ip"],
            "username": h["username"],
            "ssh_port": h.get("ssh_port", 22),
            "remark": h.get("remark", ""),
        }
        for h in _hosts
    ]


def get_host_by_id(host_id: int) -> dict[str, Any] | None:
    """Return full host entry (including password) by id, or None if not found."""
    for h in _hosts:
        if h.get("id") == host_id:
            return h
    return None


def get_host_by_ip(host_ip: str) -> dict[str, Any] | None:
    """Return full host entry (including password) by host_ip, or None if not found."""
    for h in _hosts:
        if h.get("host_ip") == host_ip:
            return h
    return None


def resolve_host(host_id: int | str) -> dict[str, Any] | None:
    """Resolve host by id (int) or by host_ip (str). Returns full entry or None."""
    if isinstance(host_id, int):
        return get_host_by_id(host_id)
    return get_host_by_ip(str(host_id))
