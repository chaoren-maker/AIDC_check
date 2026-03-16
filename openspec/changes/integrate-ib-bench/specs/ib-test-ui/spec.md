# Spec: ib-test-ui

## ADDED Requirements

### Requirement: IB card view in Web UI

The Web UI SHALL provide an "IB 网卡" page that displays the InfiniBand card list for the currently selected host.

#### Scenario: User views IB cards for selected host

- **WHEN** the user has selected a host and opens the IB 网卡 page
- **THEN** the UI fetches the IB card discovery API and displays a table of cards with interface name, speed (200G/400G), LID, and port status

#### Scenario: No host selected or API error

- **WHEN** no host is selected or the API returns an error
- **THEN** the UI displays a clear error message

### Requirement: IB test page with single-pair and batch modes

The Web UI SHALL provide an "IB 测试" page that supports both single-pair testing (select server + client) and batch testing (auto-pair all loaded hosts).

#### Scenario: User runs a single-pair bandwidth test

- **WHEN** the user selects a server host and a client host, chooses "bandwidth" test type, and clicks "execute"
- **THEN** the UI calls the bandwidth test API and, upon completion, displays per-card-pair results with bandwidth values and PASS/FAIL status

#### Scenario: User runs a batch test

- **WHEN** the user clicks "batch test", selects test type (bandwidth or latency), and confirms
- **THEN** the UI calls the batch test API, shows a "running" status indicator, polls for completion, and upon completion displays a summary table of all pairs with PASS/FAIL

#### Scenario: User views batch test results and downloads logs

- **WHEN** batch test results are displayed
- **THEN** each result row SHALL have a downloadable log link, and the overall results SHALL show pass/fail counts in a summary card

### Requirement: Historical test results view

The Web UI SHALL display a list of past test runs (from the results API) with timestamp, type, and pass/fail counts, allowing the user to view details and download logs for any past run.

#### Scenario: User views historical results

- **WHEN** the user navigates to the IB test results section
- **THEN** the UI displays a table of past test runs; clicking a row shows the detailed per-pair results; a download button provides the raw log file
