# Spec: gpu-metrics-inspection

## ADDED Requirements

### Requirement: Expose GPU metrics via API for a remote host

The system SHALL provide an API that returns current GPU metrics (temperature, memory used/total, utilization, and optionally power and ECC errors) per GPU for a **remote** host (identified by host id or IP from the loaded host list). The system SHALL obtain this by connecting to the remote host (e.g. via SSH) and executing the relevant commands (e.g. nvidia-smi) there.

#### Scenario: Client requests current GPU metrics for a loaded host

- **WHEN** the client calls the GPU metrics API with a valid host identifier
- **THEN** the system connects to that remote host, runs the relevant commands, and returns per-GPU metrics (e.g. temperature, memory used/total, utilization) in a structured format (e.g. JSON)

#### Scenario: Metrics unavailable for one or more GPUs on remote host

- **WHEN** one or more GPUs are offline or metrics cannot be read on the remote host
- **THEN** the response SHALL include those GPUs with an error or null value and a clear status so the client can distinguish healthy vs. unavailable

### Requirement: Provide GPU health inspection (inspection run) for a remote host

The system SHALL support a single “inspection” operation for a **remote** host that collects current GPU metrics (via SSH) and evaluates them against configurable (or default) thresholds to produce a health status (e.g. ok, warning, error) per GPU and a summary for that host.

#### Scenario: Client triggers inspection for a loaded host

- **WHEN** the client triggers an inspection (e.g. via dedicated API) with a valid host identifier
- **THEN** the system connects to that remote host, collects current GPU metrics, applies threshold checks (e.g. temperature, memory usage), and returns per-GPU status and an overall summary (e.g. “all ok”, “2 warning”, “1 error”)

#### Scenario: Inspection with custom thresholds

- **WHEN** the system supports configurable thresholds (e.g. max temperature, max memory usage) and the user has provided custom values
- **THEN** the inspection SHALL use those thresholds to determine warning/error status

### Requirement: Inspection report summary

The system SHALL return an inspection result that includes at least: per-GPU health status and a short summary (e.g. counts of ok/warning/error) suitable for display in the Web UI.

#### Scenario: Summary for UI

- **WHEN** the client requests inspection results for a host
- **THEN** the response SHALL include a summary field (e.g. total GPUs, count ok/warning/error) so the frontend can display a one-line or compact summary without parsing all per-GPU details
