"""
SSH connector: connect to remote host from loaded list, execute commands, return stdout/stderr.
Timeout and clear errors for connection refused, auth failure, command not found.
"""

from __future__ import annotations

import paramiko

from app.host_store import resolve_host

DEFAULT_TIMEOUT = 30


class SSHRunnerError(Exception):
    """SSH or command execution failed."""

    pass


def run_remote_command(
    host_id: int | str,
    command: str,
    timeout: int = DEFAULT_TIMEOUT,
) -> tuple[str, str, int]:
    """
    Run a single command on the remote host. No script is left on the remote.
    Returns (stdout, stderr, exit_code). Raises SSHRunnerError on connection/auth failure.
    """
    host = resolve_host(host_id)
    if not host:
        raise SSHRunnerError(f"Host not found: {host_id}")
    host_ip = host["host_ip"]
    port = host.get("ssh_port", 22)
    username = host["username"]
    password = host["password"]
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    try:
        client.connect(
            hostname=host_ip,
            port=port,
            username=username,
            password=password,
            timeout=timeout,
            allow_agent=False,
            look_for_keys=False,
        )
    except paramiko.AuthenticationException as e:
        raise SSHRunnerError(f"SSH authentication failed for {host_ip}: {e!s}")
    except paramiko.SSHException as e:
        raise SSHRunnerError(f"SSH error for {host_ip}: {e!s}")
    except OSError as e:
        err_msg = str(e).lower()
        if "connection refused" in err_msg or "errno 61" in str(e):
            raise SSHRunnerError(f"Connection refused to {host_ip}:{port}")
        if "timed out" in err_msg or "timeout" in err_msg:
            raise SSHRunnerError(f"Connection timeout to {host_ip}:{port}")
        raise SSHRunnerError(f"Connection to {host_ip} failed: {e!s}")
    try:
        stdin, stdout, stderr = client.exec_command(command, timeout=timeout)
        out = stdout.read().decode("utf-8", errors="replace")
        err = stderr.read().decode("utf-8", errors="replace")
        code = stdout.channel.recv_exit_status()
        return out, err, code
    finally:
        client.close()


def run_remote_commands(
    host_id: int | str,
    commands: list[str],
    timeout: int = DEFAULT_TIMEOUT,
) -> dict[str, tuple[str, str, int]]:
    """
    Run multiple read-only commands on the same host (new connection per command for simplicity).
    Returns dict command -> (stdout, stderr, exit_code). No script is left on remote.
    """
    result: dict[str, tuple[str, str, int]] = {}
    for cmd in commands:
        result[cmd] = run_remote_command(host_id, cmd, timeout=timeout)
    return result


def run_and_get_stdout(
    host_id: int | str,
    command: str,
    timeout: int = DEFAULT_TIMEOUT,
) -> str:
    """
    Run one command and return stdout. Raises SSHRunnerError on connection/auth failure.
    If exit code is non-zero, still returns stdout but caller can check stderr via run_remote_command.
    """
    out, err, code = run_remote_command(host_id, command, timeout=timeout)
    return out
