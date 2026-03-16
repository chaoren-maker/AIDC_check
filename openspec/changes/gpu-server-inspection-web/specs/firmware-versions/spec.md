# Spec: firmware-versions

## ADDED Requirements

### Requirement: Expose GPU driver and firmware versions via API for a remote host

The system SHALL provide an API that returns the GPU driver version and, when available, GPU firmware/VBIOS version for each GPU on a **remote** host (identified by host id or IP from the loaded host list). The system SHALL obtain this by connecting to the remote host (e.g. via SSH) and executing the relevant commands there.

#### Scenario: Client requests GPU versions for a loaded host

- **WHEN** the client calls the firmware/versions API for GPU information with a valid host identifier
- **THEN** the system connects to that remote host, runs the relevant commands (e.g. nvidia-smi), and returns driver version and, if available, per-GPU firmware/VBIOS version

#### Scenario: No GPU or driver not installed on remote host

- **WHEN** the remote host has no GPU or the NVIDIA driver is not installed
- **THEN** the system returns an error or empty list with a clear message that GPU version information is unavailable for that host

### Requirement: Expose NIC firmware versions via API for a remote host

The system SHALL provide an API that returns firmware versions for network adapters (NICs) on the **remote** host, where such information is obtainable (e.g. via lspci, vendor tools executed over SSH).

#### Scenario: Client requests NIC firmware versions for a loaded host

- **WHEN** the client calls the firmware/versions API for NIC information with a valid host identifier
- **THEN** the system connects to that remote host, runs the relevant commands, and returns a list of NICs with firmware version where available (e.g. Mellanox/NVIDIA, Intel), and indicates unsupported or unknown for others

#### Scenario: No NIC firmware info available on remote host

- **WHEN** the remote host has NICs but the tool cannot read firmware version (e.g. vendor tool missing)
- **THEN** the system returns the list of NICs with a field indicating firmware version unknown or unsupported

### Requirement: Expose server and OS version via API for a remote host

The system SHALL provide an API that returns server (hardware/product) and OS version information (e.g. kernel, distro) for the **remote** host.

#### Scenario: Client requests server and OS info for a loaded host

- **WHEN** the client calls the server/OS version API with a valid host identifier
- **THEN** the system connects to that remote host, runs the relevant commands, and returns at least: OS distribution name/version and kernel version; if available, product name or board identifier (e.g. from DMI/sysfs)
