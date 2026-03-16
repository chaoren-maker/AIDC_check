# Spec: web-ui

## ADDED Requirements

### Requirement: Single-page UI accessible from browser

The system SHALL provide a Web UI that users can open in a browser to perform all supported operations: import Excel to load GPU host list (IP + credentials), select a host, then query topology, versions, metrics, and run inspection—all without using the command line.

#### Scenario: User opens the Web UI

- **WHEN** the user navigates to the configured URL (e.g. http://localhost:port/)
- **THEN** the UI loads and presents: a way to import Excel for host list, the list of loaded hosts, host selection, and navigation or sections for NUMA topology, firmware/versions, server/OS info, GPU metrics, and inspection

#### Scenario: UI works without external backend URL config when same origin

- **WHEN** the UI is served from the same origin as the API (e.g. same server and port)
- **THEN** the UI SHALL call the API using relative paths or the same host so that no extra configuration is required for default deployment

### Requirement: Import Excel and display host list

The Web UI SHALL allow the user to upload an Excel file to load the GPU host list (IP, username, password) and SHALL display the loaded host list (without showing passwords); the user SHALL be able to select one host as the current target for queries.

#### Scenario: User imports Excel and sees host list

- **WHEN** the user uploads a valid Excel file via the UI
- **THEN** the UI sends the file to the import API and, on success, displays the list of loaded hosts (e.g. by IP or id); the user can select a host for subsequent queries

#### Scenario: User selects a host for querying

- **WHEN** the user selects one host from the loaded list
- **THEN** subsequent requests for NUMA, versions, metrics, and inspection use that host’s identifier (e.g. IP or id)

### Requirement: Display NUMA topology for selected host

The Web UI SHALL request and display NUMA topology (nodes, CPU/memory/GPU association) from the backend API for the currently selected remote host in a readable form (e.g. table or diagram).

#### Scenario: User views NUMA topology for selected host

- **WHEN** the user has selected a host and opens the NUMA topology view and the API returns topology data
- **THEN** the UI displays NUMA nodes and the association of CPUs, memory, and GPUs to each node for that host

#### Scenario: NUMA topology API error

- **WHEN** the topology API returns an error or unavailable (e.g. SSH failure, host not loaded)
- **THEN** the UI displays an error message and does not show incorrect data

### Requirement: Display firmware and version information for selected host

The Web UI SHALL request and display GPU driver/firmware versions, NIC firmware versions, and server/OS version from the backend API for the currently selected host.

#### Scenario: User views versions for selected host

- **WHEN** the user has selected a host and opens the firmware/versions or server info view
- **THEN** the UI displays GPU versions, NIC firmware versions (where available), and server/OS version in a structured way for that host

### Requirement: Display GPU metrics and inspection results for selected host

The Web UI SHALL request and display current GPU metrics and allow the user to trigger an inspection for the currently selected host; it SHALL show per-GPU status and the inspection summary.

#### Scenario: User views GPU metrics for selected host

- **WHEN** the user has selected a host and opens the GPU metrics view
- **THEN** the UI fetches and displays current metrics (e.g. temperature, memory, utilization) per GPU for that host

#### Scenario: User runs inspection and sees results for selected host

- **WHEN** the user has selected a host and triggers an inspection (e.g. “Run inspection” button)
- **THEN** the UI calls the inspection API with that host and displays per-GPU health status and the summary (e.g. X ok, Y warning, Z error)

#### Scenario: Inspection or metrics API error

- **WHEN** the metrics or inspection API returns an error (e.g. SSH failure, host not found)
- **THEN** the UI displays an error message and does not show stale or wrong health status
