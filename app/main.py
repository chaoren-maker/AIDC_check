"""
FastAPI application entry point for AIDC inspection tool.

Runs locally and connects to remote devices (GPU/CPU/Switch/Security) via SSH.
No script is deployed on remote devices.
"""

from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, Response
from fastapi.staticfiles import StaticFiles

from app.routers import dcgmi as dcgmi_router
from app.routers import eth as eth_router
from app.routers import hosts as hosts_router
from app.routers import ib as ib_router
from app.routers import ib_topo as ib_topo_router
from app.routers import remote as remote_router

app = FastAPI(
    title="AIDC Inspection",
    description="Local tool to inspect remote AIDC devices (GPU, CPU, switch, security) via SSH.",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


STATIC_DIR = Path(__file__).resolve().parent.parent / "static"


@app.get("/favicon.ico", include_in_schema=False)
async def favicon() -> Response:
    """
    Return site favicon if present under static/.

    Prefer ICO, fall back to PNG. If no icon is found, return 204 to
    avoid noisy 404s while keeping browser behaviour simple.
    """
    for name in ("favicon.ico", "favicon.png"):
        icon_path = STATIC_DIR / name
        if icon_path.exists():
            return FileResponse(icon_path)
    return Response(status_code=204)


@app.get("/", include_in_schema=False)
async def serve_index():
    """根路径返回 Web UI 页面。"""
    index = STATIC_DIR / "index.html"
    if not index.exists():
        return {"service": "aidc-inspection", "ui": "static files not found"}
    return FileResponse(index)


@app.get("/health")
async def health() -> dict:
    """Health check for deployment/monitoring."""
    return {"status": "healthy"}


app.include_router(hosts_router.router)
app.include_router(remote_router.router)
app.include_router(ib_router.router)
app.include_router(ib_topo_router.router)
app.include_router(dcgmi_router.router)
app.include_router(eth_router.router)


app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")
