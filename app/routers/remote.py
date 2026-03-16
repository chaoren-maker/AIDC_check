"""
Remote host APIs: NUMA topology, versions, GPU metrics and inspection.
All require host_id and use SSH; return clear errors for unknown host or SSH failure.
"""

from fastapi import APIRouter, HTTPException

from app.remote.gpu_metrics import fetch_gpu_metrics, run_inspection
from app.remote.numa import fetch_numa_topology
from app.remote.versions import fetch_gpu_versions, fetch_nic_firmware, fetch_server_os_version
from app.ssh_runner import SSHRunnerError

router = APIRouter(prefix="/api/hosts", tags=["remote"])


def _host_id_from_path(host_id: str):
    try:
        return int(host_id)
    except ValueError:
        return host_id


@router.get("/{host_id}/numa-topology")
async def get_numa_topology(host_id: str):
    """Get NUMA topology for the given host (by id or IP)."""
    hid = _host_id_from_path(host_id)
    try:
        return fetch_numa_topology(hid)
    except SSHRunnerError as e:
        if "not found" in str(e).lower():
            raise HTTPException(status_code=404, detail=str(e))
        raise HTTPException(status_code=502, detail=str(e))


@router.get("/{host_id}/versions/gpu")
async def get_versions_gpu(host_id: str):
    """Get GPU driver and firmware versions for the given host."""
    hid = _host_id_from_path(host_id)
    try:
        return fetch_gpu_versions(hid)
    except SSHRunnerError as e:
        if "not found" in str(e).lower():
            raise HTTPException(status_code=404, detail=str(e))
        raise HTTPException(status_code=502, detail=str(e))


@router.get("/{host_id}/versions/nic")
async def get_versions_nic(host_id: str):
    """Get NIC firmware info for the given host."""
    hid = _host_id_from_path(host_id)
    try:
        return {"nics": fetch_nic_firmware(hid)}
    except SSHRunnerError as e:
        if "not found" in str(e).lower():
            raise HTTPException(status_code=404, detail=str(e))
        raise HTTPException(status_code=502, detail=str(e))


@router.get("/{host_id}/versions/server")
async def get_versions_server(host_id: str):
    """Get server/OS version (kernel, distro) for the given host."""
    hid = _host_id_from_path(host_id)
    try:
        return fetch_server_os_version(hid)
    except SSHRunnerError as e:
        if "not found" in str(e).lower():
            raise HTTPException(status_code=404, detail=str(e))
        raise HTTPException(status_code=502, detail=str(e))


@router.get("/{host_id}/gpu/metrics")
async def get_gpu_metrics(host_id: str):
    """Get current GPU metrics (temperature, memory, utilization) for the given host."""
    hid = _host_id_from_path(host_id)
    try:
        return fetch_gpu_metrics(hid)
    except SSHRunnerError as e:
        if "not found" in str(e).lower():
            raise HTTPException(status_code=404, detail=str(e))
        raise HTTPException(status_code=502, detail=str(e))


@router.get("/{host_id}/gpu/inspection")
async def get_gpu_inspection(host_id: str):
    """Run GPU inspection on the given host; returns per-GPU status and summary."""
    hid = _host_id_from_path(host_id)
    try:
        return run_inspection(hid)
    except SSHRunnerError as e:
        if "not found" in str(e).lower():
            raise HTTPException(status_code=404, detail=str(e))
        raise HTTPException(status_code=502, detail=str(e))
