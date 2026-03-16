"""
Excel host list format definition and documentation.

Required columns: host_ip, username, password.
Optional columns: ssh_port (default 22), remark.

Header row is row 1; data starts at row 2.
Supported aliases for column names (case-insensitive strip):
  host_ip: "host_ip", "IP", "主机IP", "主机"
  username: "username", "用户名", "账号"
  password: "password", "密码"
  ssh_port: "ssh_port", "端口", "ssh端口"
  remark: "remark", "备注", "描述"
"""

REQUIRED_COLUMNS = ("host_ip", "username", "password")
OPTIONAL_COLUMNS = ("ssh_port", "remark")

# Aliases: standard key -> list of allowed header names (lowercase)
COLUMN_ALIASES = {
    "host_ip": ["host_ip", "ip", "主机ip", "主机"],
    "username": ["username", "用户名", "账号"],
    "password": ["password", "密码"],
    "ssh_port": ["ssh_port", "端口", "ssh端口"],
    "remark": ["remark", "备注", "描述"],
}

DEFAULT_SSH_PORT = 22
