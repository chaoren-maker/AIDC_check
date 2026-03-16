# Spec: ib-latency-test

## ADDED Requirements

### Requirement: Execute IB latency test between two remote hosts

The system SHALL provide an API that runs `ib_write_lat` between a server host and a client host for multiple message sizes (64, 128, 256, 512 bytes), returning per-size average latency and PASS/FAIL status.

#### Scenario: Single-pair latency test succeeds

- **WHEN** the client calls the latency test API with valid server and client host identifiers
- **THEN** the system runs `ib_write_lat` for each message size on each matching card pair, and returns per-card per-size average latency (μs) with PASS/FAIL (64B/128B < 3.0μs, 256B/512B < 4.0μs). A card pair is PASS only if all four sizes pass.

#### Scenario: Remote tool not installed

- **WHEN** `ib_write_lat` is not installed on either host
- **THEN** the system returns a clear error message

#### Scenario: Partial failure

- **WHEN** some message sizes fail but others succeed
- **THEN** the system returns results for all sizes with individual PASS/FAIL and the card pair is marked FAIL overall
