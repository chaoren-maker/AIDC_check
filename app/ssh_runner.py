"""
Unified SSH connector — supports password, key file, and agent authentication.
All modules should use create_ssh_client() or run_remote_command() from here.
"""

from __future__ import annotations

import paramiko

from app.host_store import resolve_host

DEFAULT_TIMEOUT = 30


class SSHRunnerError(Exception):
    """SSH or command execution failed."""

    pass


# ---------------------------------------------------------------------------
# Private key loader (ported from ib-bench credential.py)
# ---------------------------------------------------------------------------

def _load_private_key(key_path: str) -> paramiko.PKey:
    """Auto-detect key format and load (Ed25519 > RSA > ECDSA)."""
    key_classes = [
        paramiko.Ed25519Key,
        paramiko.RSAKey,
        paramiko.ECDSAKey,
    ]
    last_error = None
    for key_class in key_classes:
        try:
            return key_class.from_private_key_file(key_path)
        except (paramiko.SSHException, ValueError, TypeError) as exc:
            last_error = exc
            continue

    raise SSHRunnerError(
        f"Cannot load key {key_path} (tried Ed25519, RSA, ECDSA). "
        f"Last error: {last_error}"
    )


# ---------------------------------------------------------------------------
# Unified SSH client creator
# ---------------------------------------------------------------------------

def create_ssh_client(
    host: dict,
    timeout: int = DEFAULT_TIMEOUT,
) -> paramiko.SSHClient:
    """Create an SSHClient with the correct auth method based on host['auth_type'].

    Supported auth_type values:
      - "password" — password authentication
      - "key"      — private key file authentication
      - "agent"    — SSH agent / system key lookup
    """
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())

    auth_type = host.get("auth_type", "password")
    common = dict(
        hostname=host["host_ip"],
        port=host.get("ssh_port", 22),
        username=host["username"],
        timeout=timeout,
    )

    try:
        if auth_type == "key":
            key_path = host.get("key_path", "")
            if not key_path:
                raise SSHRunnerError(
                    f"auth_type is 'key' but no key_path for {host['host_ip']}"
                )
            pkey = _load_private_key(key_path)
            client.connect(
                **common,
                pkey=pkey,
                allow_agent=False,
                look_for_keys=False,
            )
        elif auth_type == "agent":
            client.connect(
                **common,
                allow_agent=True,
                look_for_keys=True,
            )
        else:
            client.connect(
                **common,
                password=host.get("password", ""),
                allow_agent=False,
                look_for_keys=False,
            )
    except paramiko.AuthenticationException as exc:
        raise SSHRunnerError(
            f"SSH authentication failed for {host['host_ip']} "
            f"(auth_type={auth_type}): {exc}"
        ) from exc
    except paramiko.SSHException as exc:
        raise SSHRunnerError(f"SSH error for {host['host_ip']}: {exc}") from exc
    except OSError as exc:
        err_msg = str(exc).lower()
        if "connection refused" in err_msg or "errno 61" in str(exc):
            raise SSHRunnerError(
                f"Connection refused to {host['host_ip']}:{host.get('ssh_port', 22)}"
            ) from exc
        if "timed out" in err_msg or "timeout" in err_msg:
            raise SSHRunnerError(
                f"Connection timeout to {host['host_ip']}:{host.get('ssh_port', 22)}"
            ) from exc
        raise SSHRunnerError(
            f"Connection to {host['host_ip']} failed: {exc}"
        ) from exc

    return client


# ---------------------------------------------------------------------------
# High-level command runners (resolve host by id/ip, then connect)
# ---------------------------------------------------------------------------

def run_remote_command(
    host_id: int | str,
    command: str,
    timeout: int = DEFAULT_TIMEOUT,
) -> tuple[str, str, int]:
    """Run a single command on the remote host.

    Returns (stdout, stderr, exit_code). Raises SSHRunnerError on failure.
    """
    host = resolve_host(host_id)
    if not host:
        raise SSHRunnerError(f"Host not found: {host_id}")

    client = create_ssh_client(host, timeout=timeout)
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
    """Run multiple commands on the same host, reusing one SSH connection."""
    host = resolve_host(host_id)
    if not host:
        raise SSHRunnerError(f"Host not found: {host_id}")

    client = create_ssh_client(host, timeout=timeout)
    result: dict[str, tuple[str, str, int]] = {}
    try:
        for cmd in commands:
            stdin, stdout, stderr = client.exec_command(cmd, timeout=timeout)
            out = stdout.read().decode("utf-8", errors="replace")
            err = stderr.read().decode("utf-8", errors="replace")
            code = stdout.channel.recv_exit_status()
            result[cmd] = (out, err, code)
    finally:
        client.close()
    return result


def run_and_get_stdout(
    host_id: int | str,
    command: str,
    timeout: int = DEFAULT_TIMEOUT,
) -> str:
    """Run one command and return stdout."""
    out, err, code = run_remote_command(host_id, command, timeout=timeout)
    return out
