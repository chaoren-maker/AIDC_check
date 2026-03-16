# Tasks: GPU Server Inspection Web Tool

## 1. Project setup

- [x] 1.1 Create Python project layout (backend app module, requirements.txt or pyproject.toml)
- [x] 1.2 Add FastAPI, uvicorn, paramiko (SSH), openpyxl (Excel) dependencies; create minimal app with health/root route
- [x] 1.3 Add CORS middleware so frontend can call API from browser
- [x] 1.4 Document that the app runs locally and connects to remote GPU hosts via SSH; no script is deployed on GPU servers

## 2. Host list and Excel import

- [x] 2.1 Define Excel format (e.g. columns: IP/host, username, password; optional port, remark) and document it
- [x] 2.2 Implement Excel parser: read uploaded file, validate required columns, return list of host entries (id, IP, username, password); handle invalid/missing rows with clear errors
- [x] 2.3 Implement in-memory or simple file store for loaded host list (no passwords in list API response)
- [x] 2.4 Expose POST /api/hosts/import for Excel file upload; on success replace or append loaded host list and return host list (without passwords)
- [x] 2.5 Expose GET /api/hosts to return current loaded host list (id, IP, username only; no password)

## 3. SSH remote command runner

- [x] 3.1 Implement SSH connector (e.g. paramiko): given host id or IP, look up credentials from loaded list, connect with username/password, execute a single command or short script, return stdout/stderr
- [x] 3.2 Add timeout and error handling (connection refused, auth failure, command not found); return clear error messages for API consumers
- [x] 3.3 Add helper to run multiple read-only commands on same host (e.g. nvidia-smi, numactl) and parse output; ensure no script is left on remote host

## 4. NUMA topology API (remote)

- [x] 4.1 Implement remote NUMA data collection: via SSH run numactl (or equivalent) on remote host and parse NUMA nodes, CPU, memory layout
- [x] 4.2 Add logic to associate each GPU (from nvidia-smi on remote) with NUMA node on that host
- [x] 4.3 Expose GET /api/hosts/{host_id}/numa-topology (or query param host_id) that uses loaded credentials to SSH and return JSON; return clear error if host not in list or SSH/command fails

## 5. Firmware and version APIs (remote)

- [x] 5.1 Implement remote GPU version collection: via SSH run nvidia-smi --query on remote host, parse driver and firmware/VBIOS; expose GET /api/hosts/{host_id}/versions/gpu (or equivalent)
- [x] 5.2 Implement remote NIC firmware collection (lspci/vendor tools on remote) and include in versions response or separate endpoint
- [x] 5.3 Implement remote server/OS version collection (kernel, distro, optional DMI on remote) and expose GET /api/hosts/{host_id}/versions/server (or single /versions including GPU, NIC, server)
- [x] 5.4 All version endpoints accept host identifier and use SSH; return clear errors for unknown host or SSH failure

## 6. GPU metrics and inspection API (remote)

- [x] 6.1 Implement remote GPU metrics collection: via SSH run nvidia-smi --query on remote host, parse temperature, memory, utilization; expose GET /api/hosts/{host_id}/gpu/metrics
- [x] 6.2 Define default inspection thresholds (e.g. max temp, max memory usage) and optional config/env override
- [x] 6.3 Implement GET or POST /api/hosts/{host_id}/gpu/inspection: SSH to host, collect metrics, apply thresholds, return per-GPU status and summary (ok/warning/error counts); return clear errors for unknown host or SSH failure

## 7. Web UI structure and host management

- [ ] 7.1 Create static frontend directory and single HTML entry page with navigation: Import Excel, Host list, NUMA, Versions, GPU metrics, Inspection
- [ ] 7.2 Add minimal CSS for layout, tables/cards, file upload area; ensure UI is usable from browser
- [ ] 7.3 Implement Excel upload in UI: file input, POST to /api/hosts/import, on success refresh and display host list (without passwords)
- [ ] 7.4 Implement host list display and host selection (e.g. dropdown or table row click); store selected host id in JS for subsequent API calls
- [ ] 7.5 Implement JS helper to call backend API with current host id and handle errors (e.g. no host selected, SSH failure, host not found)

## 8. Web UI – NUMA and versions views

- [ ] 8.1 Implement NUMA topology view: when a host is selected, fetch /api/hosts/{host_id}/numa-topology and render nodes with CPU/memory/GPU association (table or list)
- [ ] 8.2 Implement versions view: when a host is selected, fetch GPU/NIC/server version APIs and display in structured sections
- [ ] 8.3 Show clear error state when no host selected, or when topology/versions API returns error (e.g. SSH failed, host not in list)

## 9. Web UI – GPU metrics and inspection

- [ ] 9.1 Implement GPU metrics view: when a host is selected, fetch /api/hosts/{host_id}/gpu/metrics and display per-GPU metrics (temperature, memory, utilization)
- [ ] 9.2 Add “Run inspection” control that calls /api/hosts/{host_id}/gpu/inspection and displays per-GPU health status and summary (e.g. X ok, Y warning, Z error)
- [ ] 9.3 Show error state when metrics or inspection API fails (e.g. no host selected, SSH error)

## 10. Serving and run

- [x] 10.1 Mount or serve static frontend from FastAPI (e.g. StaticFiles at /) so opening root URL in browser loads the UI
- [x] 10.2 Add README: run backend locally (uvicorn), open browser to localhost:port; document Excel format for host import; state that no component is installed on GPU servers
- [x] 10.3 Optional: add simple config or env for host/port and API base URL for frontend if needed
