# Spec: host-list-import

## ADDED Requirements

### Requirement: Load GPU host list from Excel upload

The system SHALL allow the user to upload an Excel file (e.g. .xlsx) that contains a list of GPU servers; each row SHALL include at least: host IP (or hostname), login username, and password, used for SSH (or equivalent) connection to that host.

#### Scenario: User uploads valid Excel file

- **WHEN** the user uploads an Excel file with the required columns (e.g. IP, username, password)
- **THEN** the system parses the file and stores the host list (in memory or local storage); the list is available for subsequent “select host and query” operations

#### Scenario: Excel file missing required columns

- **WHEN** the uploaded Excel file does not contain the required columns (IP, username, password) or column names cannot be matched (e.g. by documented aliases)
- **THEN** the system returns a clear error and does not replace the existing host list with partial or invalid data

#### Scenario: Excel file has empty or invalid rows

- **WHEN** some rows have missing IP or credentials
- **THEN** the system SHALL either skip invalid rows and import valid ones with a warning, or reject the file with a clear message; behavior SHALL be documented

### Requirement: Expose loaded host list via API

The system SHALL provide an API that returns the currently loaded list of GPU hosts (e.g. id, IP, username; password SHALL NOT be returned in list responses for security).

#### Scenario: Client requests host list

- **WHEN** the client calls the host list API (after at least one successful import)
- **THEN** the system returns the list of hosts with identifiers (e.g. IP or internal id) and non-sensitive fields so the UI can display and let the user select a host for querying

#### Scenario: No host list loaded

- **WHEN** no Excel file has been imported yet (or list was cleared)
- **THEN** the API returns an empty list or clear “no hosts” state so the UI can prompt the user to import Excel

### Requirement: Use host credentials for remote queries

The system SHALL use the credentials (username, password) associated with each loaded host when establishing SSH (or equivalent) to that host for NUMA, version, metrics, and inspection queries.

#### Scenario: Query uses correct host credentials

- **WHEN** a query API is called with a host identifier that exists in the loaded list
- **THEN** the system uses that host’s IP and credentials to connect and run the relevant remote commands, and returns the result for that host

#### Scenario: Query for unknown or removed host

- **WHEN** the client passes a host identifier that is not in the current loaded list
- **THEN** the system returns an error (e.g. 404 or 400) indicating that the host is unknown or not loaded
