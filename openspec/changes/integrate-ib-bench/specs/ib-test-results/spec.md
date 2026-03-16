# Spec: ib-test-results

## ADDED Requirements

### Requirement: Persist test results and raw logs

The system SHALL save each test run (single-pair or batch) to a local directory (`ib_test_results/<task_id>/`) containing a structured summary (JSON) and the raw command output log (text file).

#### Scenario: Test completes and results are saved

- **WHEN** a test (single or batch) completes
- **THEN** the system creates a directory with a unique ID, writes `summary.json` (test type, timestamp, per-pair results with PASS/FAIL) and `raw_log.txt` (full command output)

### Requirement: List historical test results via API

The system SHALL provide an API to list all saved test results with their task ID, timestamp, test type, and overall pass/fail count.

#### Scenario: Client requests test result list

- **WHEN** the client calls the test results list API
- **THEN** the system returns a list of all saved test runs (task ID, timestamp, type, total/pass/fail counts)

### Requirement: Download test log file via API

The system SHALL provide an API to download the raw log file for a given test run.

#### Scenario: Client downloads log for a completed test

- **WHEN** the client calls the log download API with a valid task ID
- **THEN** the system returns the `raw_log.txt` file as a downloadable response

#### Scenario: Invalid task ID

- **WHEN** the client provides a task ID that does not exist
- **THEN** the system returns a 404 error
