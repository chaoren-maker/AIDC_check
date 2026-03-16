"""
FastAPI application entry point.

Runs locally and connects to remote GPU hosts via SSH.
No script is deployed on GPU servers.
"""

from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from app.routers import hosts as hosts_router
from app.routers import ib as ib_router
from app.routers import remote as remote_router

app = FastAPI(
    title="GPU Server Inspection",
    description="Local tool to query remote GPU hosts (NUMA, versions, metrics, inspection) via SSH.",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


STATIC_DIR = Path(__file__).resolve().parent.parent / "static"


@app.get("/", include_in_schema=False)
async def serve_index():
    """根路径返回 Web UI 页面。"""
    index = STATIC_DIR / "index.html"
    if not index.exists():
        return {"service": "gpu-server-inspection", "ui": "static files not found"}
    return FileResponse(index)


@app.get("/health")
async def health() -> dict:
    """Health check for deployment/monitoring."""
    return {"status": "healthy"}


app.include_router(hosts_router.router)
app.include_router(remote_router.router)
app.include_router(ib_router.router)


app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")
