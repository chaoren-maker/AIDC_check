"""
Parse Excel file into list of host entries (id, host_ip, username, password, ssh_port, remark).
Validates required columns and skips invalid rows with clear errors.
"""

from __future__ import annotations

from typing import Any

import openpyxl
from openpyxl.workbook import Workbook

from app.excel_format import (
    COLUMN_ALIASES,
    DEFAULT_SSH_PORT,
    OPTIONAL_COLUMNS,
    REQUIRED_COLUMNS,
)


class ExcelParseError(Exception):
    """Raised when Excel format is invalid or required columns are missing."""

    pass


def _normalize_header(cell_value: Any) -> str:
    if cell_value is None:
        return ""
    s = str(cell_value).strip().lower()
    return s


def _find_column_indexes(header_row: list[Any]) -> dict[str, int]:
    """Map standard column name -> 0-based column index. Raises ExcelParseError if required missing."""
    name_to_idx: dict[str, int] = {}
    reverse_aliases: dict[str, str] = {}
    for std_name, aliases in COLUMN_ALIASES.items():
        for a in aliases:
            reverse_aliases[a] = std_name
    for idx, cell in enumerate(header_row):
        h = _normalize_header(cell)
        if h in reverse_aliases:
            name_to_idx[reverse_aliases[h]] = idx
    for col in REQUIRED_COLUMNS:
        if col not in name_to_idx:
            raise ExcelParseError(
                f"Missing required column: need one of {COLUMN_ALIASES[col]!r} (for {col})"
            )
    return name_to_idx


def _get_cell(row: list[Any], idx: int) -> str:
    if idx >= len(row):
        return ""
    v = row[idx]
    if v is None:
        return ""
    return str(v).strip()


def _parse_port(value: str) -> int:
    if not value:
        return DEFAULT_SSH_PORT
    try:
        p = int(value)
        if 1 <= p <= 65535:
            return p
    except ValueError:
        pass
    return DEFAULT_SSH_PORT


def parse_hosts_excel(workbook: Workbook) -> list[dict[str, Any]]:
    """
    Read first sheet; row 1 = header, row 2+ = data.
    Returns list of host entries, each: id (int, 0-based), host_ip, username, password, ssh_port, remark.
    Skips rows where host_ip or username is empty; raises ExcelParseError if required columns missing.
    """
    sheet = workbook.active
    if sheet is None:
        raise ExcelParseError("Workbook has no active sheet")
    rows = list(sheet.iter_rows(values_only=True))
    if not rows:
        raise ExcelParseError("Excel file is empty")
    header_row = list(rows[0])
    col_indexes = _find_column_indexes(header_row)
    hosts: list[dict[str, Any]] = []
    for row_idx, row in enumerate(rows[1:], start=2):
        row_list = list(row) if row else []
        host_ip = _get_cell(row_list, col_indexes["host_ip"])
        username = _get_cell(row_list, col_indexes["username"])
        password = _get_cell(row_list, col_indexes["password"])
        if not host_ip or not username:
            continue
        ssh_port = (
            _parse_port(_get_cell(row_list, col_indexes["ssh_port"]))
            if "ssh_port" in col_indexes
            else DEFAULT_SSH_PORT
        )
        remark = (
            _get_cell(row_list, col_indexes["remark"])
            if "remark" in col_indexes
            else ""
        )
        hosts.append(
            {
                "id": len(hosts),
                "host_ip": host_ip,
                "username": username,
                "password": password,
                "ssh_port": ssh_port,
                "remark": remark,
            }
        )
    return hosts
