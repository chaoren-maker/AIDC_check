# Spec: numa-topology

## ADDED Requirements

### Requirement: Expose NUMA topology via API for a remote host

The system SHALL provide an API that returns the NUMA topology of a **remote** GPU host (identified by host id or IP from the loaded host list), including NUMA nodes and the association of CPUs, memory, and GPUs to each node. The system SHALL obtain this by connecting to the remote host (e.g. via SSH) and executing the relevant commands there, without deploying any script on the remote host.

#### Scenario: Client requests NUMA topology for a loaded host

- **WHEN** the client calls the NUMA topology API with a valid host identifier (e.g. IP or id)
- **THEN** the system connects to that remote host using the loaded credentials, runs the necessary commands (e.g. numactl), and returns a structured response containing at least: list of NUMA nodes, per-node CPU list, per-node memory size/affinity, and which GPUs (by index or bus id) are associated with which NUMA node

#### Scenario: NUMA tools unavailable on remote host

- **WHEN** the API is invoked for a remote host and the required tools (e.g. numactl) are not available or fail on that host
- **THEN** the system returns an error or partial response with a clear indication that NUMA topology could not be determined for that host

### Requirement: GPU-to-NUMA association

The system SHALL report which NUMA node each GPU is closest to (or attached to) on the remote host, so that users can reason about GPU–CPU–memory affinity.

#### Scenario: Multiple GPUs and NUMA nodes on remote host

- **WHEN** the remote host has multiple GPUs and multiple NUMA nodes
- **THEN** the topology response SHALL include, for each GPU, the NUMA node id or affinity information
