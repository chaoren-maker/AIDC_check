"""
Host list and Excel import API.
"""

from io import BytesIO

from fastapi import APIRouter, File, HTTPException, UploadFile
from openpyxl import load_workbook

from app.excel_parser import ExcelParseError, parse_hosts_excel
from app.host_store import get_hosts_safe, replace_hosts

router = APIRouter(prefix="/api/hosts", tags=["hosts"])


@router.get("")
async def list_hosts():
    """Return current loaded host list (id, host_ip, username, ssh_port, remark). No passwords."""
    return {"hosts": get_hosts_safe()}


@router.post("/import")
async def import_hosts(file: UploadFile = File(...)):
    """
    Upload Excel file to load GPU host list.
    On success, replaces the loaded host list and returns the new list (without passwords).
    """
    if not file.filename or not file.filename.lower().endswith((".xlsx", ".xls")):
        raise HTTPException(
            status_code=400,
            detail="File must be an Excel file (.xlsx)",
        )
    try:
        contents = await file.read()
        workbook = load_workbook(filename=BytesIO(contents), read_only=False)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Invalid Excel file: {e!s}")
    try:
        hosts = parse_hosts_excel(workbook)
    except ExcelParseError as e:
        raise HTTPException(status_code=400, detail=str(e))
    if not hosts:
        raise HTTPException(
            status_code=400,
            detail="No valid rows found; ensure host_ip and username are set for at least one row.",
        )
    replace_hosts(hosts)
    return {"hosts": get_hosts_safe(), "message": f"Imported {len(hosts)} host(s)."}
