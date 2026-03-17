"""
In-memory store for loaded GPU host list.
List API responses must not include passwords or key paths.
"""

from __future__ import annotations

from typing import Any

_hosts: list[dict[str, Any]] = []


def replace_hosts(hosts: list[dict[str, Any]]) -> None:
    """Replace the current host list."""
    global _hosts
    _hosts = list(hosts)


def update_host(host_id: int, updates: dict[str, Any]) -> bool:
    """Update fields of a single host entry by id. Returns True if found."""
    for h in _hosts:
        if h.get("id") == host_id:
            h.update(updates)
            return True
    return False


def get_hosts_safe() -> list[dict[str, Any]]:
    """Return host list for API — no password, no key_path."""
    return [
        {
            "id": h["id"],
            "host_ip": h["host_ip"],
            "hostname": h.get("hostname", ""),
            "username": h["username"],
            "auth_type": h.get("auth_type", "password"),
            "ssh_port": h.get("ssh_port", 22),
            "remark": h.get("remark", ""),
        }
        for h in _hosts
    ]


def remove_host(host_id: int) -> bool:
    """Remove a host by id. Returns True if found and removed."""
    global _hosts
    before = len(_hosts)
    _hosts = [h for h in _hosts if h.get("id") != host_id]
    return len(_hosts) < before


def clear_hosts() -> int:
    """Remove all hosts. Returns count removed."""
    global _hosts
    count = len(_hosts)
    _hosts = []
    return count


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
