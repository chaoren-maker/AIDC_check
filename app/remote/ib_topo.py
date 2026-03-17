"""
Parse `iblinkinfo` output and build an IB Leaf-Spine topology model.

Provides wiring-order validation: checks port numbering consistency,
spine full-mesh completeness, and server-to-leaf mapping correctness.
"""

from __future__ import annotations

import re
from collections import defaultdict
from typing import Any


# ---------------------------------------------------------------------------
# Regex patterns for the two major sections of iblinkinfo output
# ---------------------------------------------------------------------------

# "CA: <description>:" header (host or aggregation node entry)
RE_CA_HEADER = re.compile(r"^CA:\s+(.+):$")

# "Switch: <guid> <name>:" header
RE_SWITCH_HEADER = re.compile(r"^Switch:\s+(0x[\da-fA-F]+)\s+(\S+):")

# Active link line (inside a Switch block)
#   LID  PORT[flags] ==( <width> <speed> Active/ LinkUp)==> LID PORT[flags] "remote_name" (info)
RE_LINK_ACTIVE = re.compile(
    r"^\s+(\d+)\s+(\d+)\[.*?\]\s+==\(\s*(\S+)\s+([\d.]+\s+\S+)\s+Active/\s*LinkUp\)==>\s+"
    r"(\d+)\s+(\d+)\[.*?\]\s+\"([^\"]*)\""
)

# Down / Polling link line
RE_LINK_DOWN = re.compile(
    r"^\s+(\d+)\s+(\d+)\[.*?\]\s+==\(\s+Down/\s*Polling\)==>"
)


def _classify_node(name: str) -> str:
    """Classify a device name into spine / leaf / server / aggregation / unknown."""
    lower = name.lower()
    if lower.startswith("ibspine"):
        return "spine"
    if lower.startswith("ibleaf"):
        return "leaf"
    if "aggregation" in lower:
        return "aggregation"
    if "gpu" in lower or "hca" in lower.split() or "ib" in lower:
        return "server"
    return "unknown"


def _extract_server_host(full_name: str) -> str:
    """Extract the hostname portion from a CA name like 'bj09-gpu-200b-0001 ib7s400p7'."""
    parts = full_name.strip().split()
    if len(parts) >= 1:
        return parts[0]
    return full_name


def _extract_hca_label(full_name: str) -> str:
    """Extract the IB card label like 'ib7s400p7' or 'HCA-8' from a CA name."""
    parts = full_name.strip().split()
    if len(parts) >= 2:
        return parts[1]
    return ""


def parse_iblinkinfo(text: str) -> dict[str, Any]:
    """
    Parse raw iblinkinfo output into a structured topology dictionary.

    Returns:
        {
            "switches": {
                "ibleaf07": {
                    "guid": "0x...",
                    "type": "leaf",
                    "links": [
                        {
                            "local_lid": 10, "local_port": 1,
                            "remote_lid": 129, "remote_port": 1,
                            "width": "4X", "speed": "106.25 Gbps",
                            "remote_name": "bj09-gpu-200b-0001 ib7s400p7",
                            "status": "active"
                        },
                        {"local_lid": 10, "local_port": 5, "status": "down"},
                        ...
                    ]
                },
                ...
            },
            "spines": ["ibspine01", ...],
            "leafs": ["ibleaf01", ...],
            "servers": ["bj09-gpu-200b-0001", ...],
        }
    """
    switches: dict[str, dict[str, Any]] = {}
    spines: set[str] = set()
    leafs: set[str] = set()
    servers: set[str] = set()

    current_switch: str | None = None

    for line in text.splitlines():
        sw_match = RE_SWITCH_HEADER.match(line)
        if sw_match:
            guid, name = sw_match.group(1), sw_match.group(2)
            current_switch = name
            node_type = _classify_node(name)
            switches[name] = {"guid": guid, "type": node_type, "links": []}
            if node_type == "spine":
                spines.add(name)
            elif node_type == "leaf":
                leafs.add(name)
            continue

        if current_switch is None:
            ca_match = RE_CA_HEADER.match(line)
            if ca_match:
                desc = ca_match.group(1)
                if _classify_node(desc) == "server":
                    servers.add(_extract_server_host(desc))
            active_match = RE_LINK_ACTIVE.search(line)
            if active_match:
                remote_name = active_match.group(7)
                if "gpu" in remote_name.lower():
                    servers.add(_extract_server_host(remote_name))
            continue

        active_match = RE_LINK_ACTIVE.match(line)
        if active_match:
            remote_name = active_match.group(7)
            remote_type = _classify_node(remote_name)
            if remote_type == "server":
                servers.add(_extract_server_host(remote_name))

            switches[current_switch]["links"].append({
                "local_lid": int(active_match.group(1)),
                "local_port": int(active_match.group(2)),
                "width": active_match.group(3),
                "speed": active_match.group(4).strip(),
                "remote_lid": int(active_match.group(5)),
                "remote_port": int(active_match.group(6)),
                "remote_name": remote_name,
                "remote_type": remote_type,
                "status": "active",
            })
            continue

        down_match = RE_LINK_DOWN.match(line)
        if down_match:
            switches[current_switch]["links"].append({
                "local_lid": int(down_match.group(1)),
                "local_port": int(down_match.group(2)),
                "status": "down",
            })
            continue

    def _sort_key(name: str) -> tuple[str, int]:
        m = re.search(r"(\d+)$", name)
        return (re.sub(r"\d+$", "", name), int(m.group(1)) if m else 0)

    return {
        "switches": switches,
        "spines": sorted(spines, key=_sort_key),
        "leafs": sorted(leafs, key=_sort_key),
        "servers": sorted(servers),
    }


# ---------------------------------------------------------------------------
# Topology analysis & wiring validation
# ---------------------------------------------------------------------------

def analyze_topology(parsed: dict[str, Any]) -> dict[str, Any]:
    """
    Build a high-level topology view and run wiring validations.

    Returns:
        {
            "spine_leaf_matrix": { "ibspine01": { "ibleaf01": [port_pair, ...], ... }, ... },
            "leaf_server_map": { "ibleaf07": [ { "server": "...", "hca": "...", "port": 1 }, ... ] },
            "anomalies": [
                { "level": "error"|"warning", "type": "...", "message": "...", "detail": {...} },
                ...
            ],
            "summary": { ... }
        }
    """
    switches = parsed["switches"]
    spine_names = parsed["spines"]
    leaf_names = parsed["leafs"]
    server_names = parsed["servers"]

    spine_leaf_matrix: dict[str, dict[str, list]] = {s: {} for s in spine_names}
    leaf_server_map: dict[str, list] = {l: [] for l in leaf_names}
    leaf_spine_map: dict[str, dict[str, list]] = {l: {} for l in leaf_names}
    anomalies: list[dict[str, Any]] = []

    # --- Build spine→leaf connections from spine switch data ---
    for spine_name in spine_names:
        sw = switches.get(spine_name)
        if not sw:
            continue
        for link in sw["links"]:
            if link["status"] != "active":
                continue
            remote = link.get("remote_name", "")
            if _classify_node(remote) == "leaf":
                leaf_name = remote
                pair = {
                    "spine_port": link["local_port"],
                    "leaf_port": link["remote_port"],
                }
                spine_leaf_matrix[spine_name].setdefault(leaf_name, []).append(pair)

    # --- Build leaf→server + leaf→spine connections from leaf switch data ---
    for leaf_name in leaf_names:
        sw = switches.get(leaf_name)
        if not sw:
            continue
        for link in sw["links"]:
            if link["status"] != "active":
                continue
            remote = link.get("remote_name", "")
            rtype = link.get("remote_type", _classify_node(remote))

            if rtype == "server":
                leaf_server_map[leaf_name].append({
                    "server": _extract_server_host(remote),
                    "hca": _extract_hca_label(remote),
                    "leaf_port": link["local_port"],
                    "server_port": link["remote_port"],
                    "full_name": remote,
                })
            elif rtype == "spine":
                spine_name_remote = remote
                leaf_spine_map[leaf_name].setdefault(spine_name_remote, []).append({
                    "leaf_port": link["local_port"],
                    "spine_port": link["remote_port"],
                })

    # Sort servers within each leaf by port
    for leaf in leaf_server_map:
        leaf_server_map[leaf].sort(key=lambda x: x["leaf_port"])

    # ===================================================================
    # Validation checks
    # ===================================================================

    # 1) Spine full-mesh: every leaf should connect to every spine with exactly 2 links
    for leaf_name in leaf_names:
        spine_conns = leaf_spine_map.get(leaf_name, {})
        for spine_name in spine_names:
            links_to_spine = spine_conns.get(spine_name, [])
            if len(links_to_spine) == 0:
                anomalies.append({
                    "level": "error",
                    "type": "missing_spine_link",
                    "message": f"{leaf_name} 缺少到 {spine_name} 的上行链路",
                    "leaf": leaf_name,
                    "spine": spine_name,
                })
            elif len(links_to_spine) != 2:
                anomalies.append({
                    "level": "warning",
                    "type": "unexpected_spine_link_count",
                    "message": f"{leaf_name} → {spine_name} 链路数={len(links_to_spine)}，预期=2",
                    "leaf": leaf_name,
                    "spine": spine_name,
                    "count": len(links_to_spine),
                })

    # 2) Server port order: within a leaf, server N should connect to port N
    for leaf_name in leaf_names:
        entries = leaf_server_map.get(leaf_name, [])
        for entry in entries:
            server_host = entry["server"]
            m = re.search(r"(\d+)$", server_host)
            if not m:
                continue
            expected_port = int(m.group(1))
            actual_port = entry["leaf_port"]
            if actual_port != expected_port:
                anomalies.append({
                    "level": "error",
                    "type": "server_port_mismatch",
                    "message": (
                        f"{leaf_name} 端口 {actual_port} 接了 {server_host}，"
                        f"预期应在端口 {expected_port}（线序错误）"
                    ),
                    "leaf": leaf_name,
                    "server": server_host,
                    "hca": entry["hca"],
                    "expected_port": expected_port,
                    "actual_port": actual_port,
                })

    # 3) Server HCA consistency: each HCA label should consistently map to one leaf
    hca_leaf_map: dict[str, set[str]] = defaultdict(set)
    for leaf_name, entries in leaf_server_map.items():
        for e in entries:
            hca_leaf_map[e["hca"]].add(leaf_name)

    for hca, leaf_set in hca_leaf_map.items():
        if len(leaf_set) > 1:
            anomalies.append({
                "level": "warning",
                "type": "hca_multi_leaf",
                "message": f"IB 卡 {hca} 出现在多个 Leaf 交换机: {', '.join(sorted(leaf_set))}",
                "hca": hca,
                "leafs": sorted(leaf_set),
            })

    # 4) Missing server: check if any known server is missing from a leaf
    server_per_leaf: dict[str, set[str]] = defaultdict(set)
    for leaf_name, entries in leaf_server_map.items():
        for e in entries:
            server_per_leaf[leaf_name].add(e["server"])

    # Leafs that have at least one server should have all servers
    active_leafs = [l for l in leaf_names if len(leaf_server_map.get(l, [])) > 0]
    for leaf_name in active_leafs:
        present = server_per_leaf[leaf_name]
        for s in server_names:
            if s not in present:
                anomalies.append({
                    "level": "warning",
                    "type": "missing_server",
                    "message": f"{leaf_name} 缺少服务器 {s} 的连接",
                    "leaf": leaf_name,
                    "server": s,
                })

    # 5) Spine port pattern consistency
    # For each spine, the leaf ports should follow a consistent pattern
    # (same leaf always uses same pair of spine ports across all spines)
    leaf_spine_port_patterns: dict[str, dict[str, list[int]]] = defaultdict(dict)
    for leaf_name, spine_conns in leaf_spine_map.items():
        for spine_name, pairs in spine_conns.items():
            spine_ports = sorted(p["spine_port"] for p in pairs)
            leaf_spine_port_patterns[leaf_name][spine_name] = spine_ports

    for leaf_name in leaf_names:
        pattern = leaf_spine_port_patterns.get(leaf_name, {})
        if not pattern:
            continue
        port_sets = list(pattern.values())
        if len(port_sets) < 2:
            continue
        reference = port_sets[0]
        for spine_name, ports in pattern.items():
            if ports != reference and len(ports) == len(reference):
                diff = [p for p in ports if p not in reference]
                if diff:
                    anomalies.append({
                        "level": "warning",
                        "type": "spine_port_inconsistency",
                        "message": (
                            f"{leaf_name} 在 {spine_name} 上使用端口 {ports}，"
                            f"与其他 Spine 不一致（参考: {reference}）"
                        ),
                        "leaf": leaf_name,
                        "spine": spine_name,
                        "ports": ports,
                        "reference": reference,
                    })

    # 6) Down ports on leafs — only flag ports in the expected server range
    max_server_idx = len(server_names)
    for leaf_name in active_leafs:
        sw = switches.get(leaf_name)
        if not sw:
            continue
        for link in sw["links"]:
            if link["status"] == "down" and 1 <= link["local_port"] <= max_server_idx:
                anomalies.append({
                    "level": "warning",
                    "type": "leaf_downlink_down",
                    "message": f"{leaf_name} 端口 {link['local_port']} Down（预期接入服务器但断开）",
                    "leaf": leaf_name,
                    "port": link["local_port"],
                })

    # --- Summary ---
    total_active_links = sum(
        1 for sw in switches.values()
        for lnk in sw["links"] if lnk["status"] == "active"
    )
    total_down_links = sum(
        1 for sw in switches.values()
        for lnk in sw["links"] if lnk["status"] == "down"
    )
    errors = [a for a in anomalies if a["level"] == "error"]
    warnings = [a for a in anomalies if a["level"] == "warning"]

    summary = {
        "spine_count": len(spine_names),
        "leaf_count": len(leaf_names),
        "server_count": len(server_names),
        "total_active_links": total_active_links,
        "total_down_links": total_down_links,
        "error_count": len(errors),
        "warning_count": len(warnings),
        "health": "healthy" if len(errors) == 0 else "unhealthy",
    }

    return {
        "spine_leaf_matrix": spine_leaf_matrix,
        "leaf_server_map": {
            leaf: [
                {
                    "server": e["server"],
                    "hca": e["hca"],
                    "leaf_port": e["leaf_port"],
                }
                for e in entries
            ]
            for leaf, entries in leaf_server_map.items()
        },
        "leaf_spine_map": {
            leaf: {
                spine: [{"leaf_port": p["leaf_port"], "spine_port": p["spine_port"]} for p in pairs]
                for spine, pairs in spine_conns.items()
            }
            for leaf, spine_conns in leaf_spine_map.items()
        },
        "anomalies": anomalies,
        "summary": summary,
    }
