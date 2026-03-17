"""
API router for IB topology analysis.

Runs `iblinkinfo` on the selected host via SSH, parses output, and
returns the topology structure with wiring validation results.
"""

from __future__ import annotations

from fastapi import APIRouter, HTTPException

from app.host_store import resolve_host
from app.remote.ib_topo import analyze_topology, parse_iblinkinfo
from app.ssh_runner import SSHRunnerError, create_ssh_client

router = APIRouter(prefix="/api/ib-topo", tags=["ib-topology"])

_cached_result: dict | None = None

CONNECT_TIMEOUT = 30
CMD_TIMEOUT = 120


def _host_id_from_path(host_id: str):
    try:
        return int(host_id)
    except ValueError:
        return host_id


@router.get("/cached/last")
async def get_cached_topology():
    """Return the most recently queried topology analysis (if any)."""
    if _cached_result is None:
        raise HTTPException(status_code=404, detail="尚未查询过 IB 拓扑")
    return _cached_result


@router.get("/{host_id}")
async def query_ib_topology(host_id: str):
    """
    SSH into the given host, run `iblinkinfo`, and return topology analysis.
    """
    global _cached_result

    hid = _host_id_from_path(host_id)
    host = resolve_host(hid)
    if not host:
        raise HTTPException(status_code=404, detail=f"主机未找到: {hid}")

    ip = host["host_ip"]
    port = host.get("ssh_port", 22)

    try:
        client = create_ssh_client(host, timeout=CONNECT_TIMEOUT)
    except SSHRunnerError as exc:
        msg = str(exc)
        if "timeout" in msg.lower():
            raise HTTPException(
                status_code=504,
                detail=f"SSH 连接 {ip}:{port} 超时（{CONNECT_TIMEOUT}s），"
                       f"请确认主机网络可达，或换一台可达主机重试",
            )
        raise HTTPException(status_code=502, detail=f"SSH 连接失败: {exc}")

    try:
        stdin, stdout, stderr = client.exec_command(
            "iblinkinfo 2>/dev/null", timeout=CMD_TIMEOUT
        )
        stdout.channel.settimeout(CMD_TIMEOUT)
        text = stdout.read().decode("utf-8", errors="replace")
    except Exception as exc:
        raise HTTPException(
            status_code=504,
            detail=f"iblinkinfo 命令执行超时（{CMD_TIMEOUT}s），"
                   f"IB 网络规模较大时可能需要更久，请稍后重试",
        )
    finally:
        client.close()

    if not text or not text.strip():
        raise HTTPException(
            status_code=422,
            detail="iblinkinfo 输出为空，请确认该主机已安装 infiniband-diags 且有 SM 权限",
        )

    parsed = parse_iblinkinfo(text)
    if not parsed["leafs"] and not parsed["spines"]:
        raise HTTPException(
            status_code=422,
            detail="未解析到交换机数据，iblinkinfo 输出格式异常",
        )

    result = analyze_topology(parsed)
    result["servers"] = parsed["servers"]
    result["spines"] = parsed["spines"]
    result["leafs"] = parsed["leafs"]

    _cached_result = result
    return result
