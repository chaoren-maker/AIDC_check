# Spec: ib-bandwidth-test

## ADDED Requirements

### Requirement: Execute IB bandwidth test between two remote hosts

The system SHALL provide an API that runs `ib_write_bw` between a server host and a client host (both from the loaded host list), testing bandwidth on each matching IB card pair. The system SHALL return per-card-pair bandwidth results and a PASS/FAIL status based on configurable thresholds.

#### Scenario: Single-pair bandwidth test succeeds

- **WHEN** the client calls the bandwidth test API with valid server and client host identifiers
- **THEN** the system connects to both hosts via SSH, starts the server-side `ib_write_bw` process, waits for readiness, starts the client-side process, collects results, and returns per-card bandwidth (Gb/s) with PASS/FAIL based on thresholds (200G >= 190 Gb/s unidirectional, 400G >= 380 Gb/s unidirectional)

#### Scenario: Bidirectional bandwidth test

- **WHEN** the client requests bidirectional mode
- **THEN** the system uses the `--bidirectional` flag and applies bidirectional thresholds (200G >= 390 Gb/s, 400G >= 760 Gb/s)

#### Scenario: Remote tool not installed

- **WHEN** `ib_write_bw` is not installed on either host
- **THEN** the system returns a clear error message indicating the tool is not available

#### Scenario: SSH or connection failure

- **WHEN** SSH connection to either host fails
- **THEN** the system returns a clear error with the failure reason (auth, timeout, refused)
