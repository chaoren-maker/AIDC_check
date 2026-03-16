# Spec: ib-card-discovery

## ADDED Requirements

### Requirement: Discover InfiniBand cards on remote host via API

The system SHALL provide an API that connects to a remote host (from the loaded host list) via SSH, runs `ibstat` and `mst status`, and returns a list of InfiniBand network cards with their type (200G/400G), interface name, LID, and port status. Virtual Function (VF) and onboard cards SHALL be filtered out.

#### Scenario: Client requests IB card list for a loaded host

- **WHEN** the client calls the IB card discovery API with a valid host identifier
- **THEN** the system connects via SSH, runs `ibstat` and `mst status -vv`, parses the output, and returns a list of IB cards grouped by speed (200G/400G) with interface name and LID for each

#### Scenario: No IB cards found on remote host

- **WHEN** the remote host has no InfiniBand cards or `ibstat` is not installed
- **THEN** the system returns an empty list with a clear message indicating no IB cards were found or the tool is not available

#### Scenario: Host not in loaded list

- **WHEN** the client provides a host identifier not in the current loaded list
- **THEN** the system returns a 404 error
