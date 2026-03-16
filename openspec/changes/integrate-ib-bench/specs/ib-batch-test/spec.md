# Spec: ib-batch-test

## ADDED Requirements

### Requirement: Batch test all loaded hosts with auto-pairing

The system SHALL provide an API that takes all loaded hosts, automatically pairs them using the dual mode (split hosts into two halves, pair by port index), groups pairs without IP conflict, and executes IB bandwidth or latency tests in parallel across groups. The API SHALL return a task identifier immediately and execute tests asynchronously.

#### Scenario: Client triggers batch bandwidth test

- **WHEN** the client calls the batch test API with test type "bandwidth"
- **THEN** the system auto-pairs all loaded hosts (dual mode), groups them without IP conflict, executes bandwidth tests group by group (parallel within each group), and stores results with a unique task ID

#### Scenario: Client triggers batch latency test

- **WHEN** the client calls the batch test API with test type "latency"
- **THEN** the system follows the same pairing and grouping logic but runs latency tests instead

#### Scenario: Fewer than 2 hosts loaded

- **WHEN** the loaded host list has fewer than 2 hosts
- **THEN** the system returns an error indicating at least 2 hosts are required for batch testing

#### Scenario: Client polls for batch test status

- **WHEN** the client polls the batch test status API with a valid task ID
- **THEN** the system returns the current status (running/completed/failed) and, if completed, the summary results with per-pair PASS/FAIL

### Requirement: Batch test concurrency control

The system SHALL limit the number of concurrent test pairs to a configurable maximum (default 10) to avoid overwhelming SSH connections or remote host resources.

#### Scenario: Concurrency within limits

- **WHEN** a batch test runs with more pairs than the concurrency limit
- **THEN** the system executes at most the configured number of pairs in parallel and queues the rest
