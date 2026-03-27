# AIDC Inspection — AI Data Center Inspection Toolkit

[中文版](./README.md)

A local web-based inspection platform. You can import an Excel host list (GPU / CPU / switch / security devices) and run connectivity checks, GPU topology/version/metrics checks, DCGMI diagnostics, as well as InfiniBand and Ethernet network tests.

It is designed for **new machine onboarding acceptance** and **daily health inspection**.

Supported SSH authentication methods:
- **Password**
- **SSH Key**
- **SSH Agent**

## Why This Tool Exists

After an AIDC environment is built, one key question remains before production launch:
**Are network links truly available, and is bandwidth actually meeting the target?**

This tool standardizes and visualizes that verification process:
- Ethernet connectivity and bandwidth checks for GPU/CPU servers (Ping + iperf)
- InfiniBand topology and bandwidth/latency checks
- Traceable logs for acceptance, troubleshooting, and retest comparison

Think of it as a lightweight “onboarding acceptance baseline tool” to quickly evaluate whether your GPU cluster is ready for stable delivery.

> **Important**: This tool runs **locally only**. It connects to remote hosts via SSH to execute commands and collect outputs. It **does not** install any agent/script/daemon on remote machines.

---

## Feature Overview

| Module | Capability | Description |
|------|------|------|
| **Import Excel** | Host list import | Auto-import after drag/drop or file selection (no manual import click needed) |
| **Host List** | Host management | View/remove hosts, upload SSH private key (for key-based hosts) |
| **Connectivity Check** | Batch ICMP Ping | Lightweight ping-based reachability check for all imported hosts |
| **GPU Topology** | NUMA topology | Retrieve GPU-CPU-NIC NUMA affinity via SSH |
| **Version Info** | Firmware/driver versions | Query nvidia-smi, CUDA, driver, OS/kernel versions |
| **Metrics & Inspection** | GPU metrics + threshold checks | Monitor temperature/power/memory/utilization and run threshold inspection |
| **DCGMI Diagnostics** | GPU health diagnostics | DCGMI Level 1 / Level 2, supports single host and batch modes |
| **Ethernet Test** | GPU/CPU bandwidth testing | iperf-based bandwidth testing for GPU/CPU hosts, single-pair + batch modes, threshold by port profile |
| **IB Topology** | InfiniBand topology view | Display switch topology and link relationships |
| **IB NIC Discovery** | IB NIC detection | Discover 200G/400G NICs via `ibstat` / `mst status` |
| **IB Test** | Bandwidth/latency performance test | Single-pair + auto-paired batch tests with downloadable logs |

---

## Run

Use the project virtual environment so system Python stays untouched.

### One-command startup (recommended)

```bash
cd /path/to/AIDC_check
./run.sh          # default port 8000
./run.sh 9000     # custom port
```

The script auto-creates `.venv`, installs dependencies, and starts the service.

### Manual startup

```bash
cd /path/to/AIDC_check
python3 -m venv .venv
source .venv/bin/activate      # Windows: .venv\Scripts\activate
pip install -r requirements.txt
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

Open `http://localhost:8000` in your browser.

---

## Excel Host Template

| Column | Required | Description |
|------|------|------|
| `host_ip` | Yes | Remote device IP or hostname |
| `hostname` | No | Display hostname |
| `username` | Yes | SSH username |
| `password` | No | SSH password (for password auth) |
| `device_type` | No | `GPU` / `CPU` / `switch` / `security` (default `GPU`) |
| `auth_type` | No | `password` / `key` / `agent` (auto-inferred if empty) |
| `key_path` | No | Private key file path (for key auth) |
| `ssh_port` | No | SSH port, default `22` |
| `remark` | No | Notes |

Use header row in the first row, then one host per row from row 2 onward. Supports `.xlsx` / `.xls`.

### Authentication modes

| Mode | Use Case | Description |
|------|---------|------|
| **password** | Servers with password | Fill `password`; `auth_type` can be auto-inferred |
| **key** | Key-based login | Fill `key_path`, or upload key in host list page |
| **agent** | SSH Agent ready | Leave both `password` and `key_path` empty |

Uploaded keys are stored under `ssh_keys/` (already ignored by Git), with permission `0600`.

---

## Connectivity Check

Batch **ICMP Ping** check for all imported devices (no SSH needed), with online/offline result display for quick network triage.

---

## GPU Checks

Sidebar group **GPU Checks** includes:

### GPU Topology

Runs commands such as `nvidia-smi topo -m` and `numactl` over SSH to show GPU-CPU-NIC topology and NUMA affinity.

### Version Info

Query remote host versions: nvidia-smi, CUDA, GPU driver, OS/kernel, etc.

### Metrics & Inspection

- **GPU metrics**: real-time temperature, power, memory usage, utilization
- **Threshold inspection**: highlight over-threshold metrics for quick alerting

### DCGMI Diagnostics

Runs NVIDIA DCGM diagnostics for GPU health verification, suitable for **new machine acceptance**:

- **Level 1** (quick): basic deployment checks (denylist, NVML, CUDA runtime, driver compatibility)
- **Level 2** (standard): adds PCIe bandwidth, power, memory, and diagnostics tests
- **Single-host mode**
- **Batch mode**
- **Result persistence**: stored in `dcgmi_results/` with structured summary + raw logs
- **Troubleshooting hints**: inline common causes and suggestions for Fail/Warn items

---

## InfiniBand Tests

Sidebar group **InfiniBand** includes:

### IB Topology

Visualize InfiniBand switch topology and connectivity relationships.

### IB NIC Discovery

For selected host, run `ibstat` and `mst status -vv` via SSH to list 200G/400G NICs (interface, LID, port state).

### IB Single-pair Test

Choose server/client and test type (`ib_write_bw` / `ib_write_lat`), then get PASS/FAIL per NIC pair.

### IB Batch Test

Auto-pairs all imported hosts (dual mode, conflict-free grouping, parallel execution). Shows summary and allows log download.

### PASS/FAIL Criteria

| Type | 200G | 400G |
|------|------|------|
| Bandwidth (unidirectional) | >= 190 Gb/s | >= 380 Gb/s |
| Bandwidth (bidirectional) | >= 390 Gb/s | >= 760 Gb/s |

| Latency | 64B | 128B | 256B | 512B |
|------|-----|------|------|------|
| Threshold | < 3.0μs | < 3.0μs | < 4.0μs | < 4.0μs |

### Logs

Each run is stored under `ib_test_results/<task_id>/`:
- `summary.json` (structured summary)
- `raw_log.txt` (full command output)

---

## Ethernet Test

Sidebar item **Ethernet Test** targets **GPU/CPU servers only** (switch/security devices excluded).

Runs `iperf` / `iperf3` on remote hosts. Recommended aggregate bandwidth thresholds:
- **2 x 10G physical ports**: aggregate >= **18 Gbits/sec**
- **2 x 25G physical ports**: aggregate >= **46 Gbits/sec**

### Single-pair Test

Select:
- Source host
- Destination host

Click **Start Test**. The tool starts iperf server on destination and iperf client on source, then displays bandwidth and PASS/FAIL.

### Batch Test

Runs across all imported GPU/CPU hosts with:
- `fullmesh` mode (all pairs)
- `sequential` mode (ordered neighbor pairs)

Displays progress/summary and supports full log download.

### Logs

Each Ethernet run is stored under `eth_test_results/<task_id>/`:
- `summary.json`
- `raw_log.txt`

---

## Dependencies

- **Local machine**: Python 3.8+. All dependencies are installed into `.venv`; system Python remains untouched.
- **Remote GPU hosts**: SSH enabled; tools such as `nvidia-smi`, `numactl`, `lspci` available. `dcgmi` required for DCGMI diagnostics.
- **Remote IB test hosts**: tools such as `ibstat`, `mst status`, `ib_write_bw`, `ib_write_lat` (usually from `perftest` package).

---

## Security Notes

- SSH keys are stored in `ssh_keys/` and ignored by Git
- Test logs are ignored by Git: `dcgmi_results/`, `ib_test_results/`, `eth_test_results/`
- Host list API responses are sanitized (no password/key path)
- `.gitignore` also excludes common sensitive files (`*.pem`, `*.key`, `*.p12`, `id_rsa*`, `credentials.json`, `.env*`, etc.)
