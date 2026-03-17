"""
Parse Excel file into list of host entries.
Validates required columns and skips invalid rows with clear errors.
Supports password, key, and agent authentication (auto-inferred).
"""

from __future__ import annotations

from typing import Any

from openpyxl.workbook import Workbook

from app.excel_format import (
    COLUMN_ALIASES,
    DEFAULT_SSH_PORT,
    REQUIRED_COLUMNS,
    VALID_AUTH_TYPES,
)


class ExcelParseError(Exception):
    """Raised when Excel format is invalid or required columns are missing."""

    pass


def _normalize_header(cell_value: Any) -> str:
    if cell_value is None:
        return ""
    return str(cell_value).strip().lower()


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


def _infer_auth_type(password: str, key_path: str, explicit_auth_type: str) -> str:
    """Determine auth_type from available fields.

    Priority:
      1. Explicit auth_type column value (if valid)
      2. password has value and is not "no" → "password"
      3. key_path has value → "key"
      4. fallback → "agent"
    """
    if explicit_auth_type and explicit_auth_type in VALID_AUTH_TYPES:
        return explicit_auth_type

    if password and password.lower() != "no":
        return "password"
    if key_path:
        return "key"
    return "agent"


def parse_hosts_excel(workbook: Workbook) -> list[dict[str, Any]]:
    """
    Read first sheet; row 1 = header, row 2+ = data.
    Returns list of host entries with auth_type auto-inferred.
    Skips rows where host_ip or username is empty.
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
        if not host_ip or not username:
            continue

        password = (
            _get_cell(row_list, col_indexes["password"])
            if "password" in col_indexes
            else ""
        )
        explicit_auth = (
            _get_cell(row_list, col_indexes["auth_type"]).lower()
            if "auth_type" in col_indexes
            else ""
        )
        key_path = (
            _get_cell(row_list, col_indexes["key_path"])
            if "key_path" in col_indexes
            else ""
        )
        ssh_port = (
            _parse_port(_get_cell(row_list, col_indexes["ssh_port"]))
            if "ssh_port" in col_indexes
            else DEFAULT_SSH_PORT
        )
        hostname = (
            _get_cell(row_list, col_indexes["hostname"])
            if "hostname" in col_indexes
            else ""
        )
        remark = (
            _get_cell(row_list, col_indexes["remark"])
            if "remark" in col_indexes
            else ""
        )

        auth_type = _infer_auth_type(password, key_path, explicit_auth)

        hosts.append(
            {
                "id": len(hosts),
                "host_ip": host_ip,
                "hostname": hostname,
                "username": username,
                "password": password if auth_type == "password" else "",
                "auth_type": auth_type,
                "key_path": key_path,
                "ssh_port": ssh_port,
                "remark": remark,
            }
        )
    return hosts
