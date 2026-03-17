"""
Excel host list format definition and documentation.

Required columns: host_ip, username.
Optional columns: hostname, password, device_type, auth_type, key_path, ssh_port, remark.

Header row is row 1; data starts at row 2.

Authentication logic (auto-inferred when auth_type is not set):
  - password has value and is not "no" → password auth
  - password is empty/missing or "no", key_path has value → key auth
  - password is empty/missing or "no", key_path empty → agent auth

device_type examples: GPU, CPU, 交换机, 安全设备 (free-text, defaults to "GPU")
"""

REQUIRED_COLUMNS = ("host_ip", "username")
OPTIONAL_COLUMNS = (
    "hostname", "password", "device_type", "auth_type",
    "key_path", "ssh_port", "remark",
)

COLUMN_ALIASES = {
    "host_ip": ["host_ip", "ip", "主机ip", "主机"],
    "hostname": ["hostname", "主机名", "机器名"],
    "username": ["username", "用户名", "账号"],
    "password": ["password", "密码"],
    "device_type": ["device_type", "设备类型", "类型", "type"],
    "auth_type": ["auth_type", "认证方式", "认证类型"],
    "key_path": ["key_path", "密钥路径", "密钥", "key"],
    "ssh_port": ["ssh_port", "端口", "ssh端口"],
    "remark": ["remark", "备注", "描述"],
}

VALID_AUTH_TYPES = ("password", "key", "agent")
DEFAULT_SSH_PORT = 22
DEFAULT_DEVICE_TYPE = "GPU"
