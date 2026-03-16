"""
InfiniBand test configuration constants and thresholds.
Ported from ib-bench config.py.
"""

# Bandwidth thresholds (Gb/s) — test result below these values is FAIL
BANDWIDTH_THRESHOLDS = {
    "unidirectional": {
        200: 190,
        400: 380,
    },
    "bidirectional": {
        200: 390,
        400: 760,
    },
}

# Latency thresholds (μs) — test result above these values is FAIL
LATENCY_THRESHOLDS = {
    64: 3.0,
    128: 3.0,
    256: 4.0,
    512: 4.0,
}

LATENCY_TEST_SIZES = [64, 128, 256, 512]
LATENCY_MTU = 4096

# Test timing
SERVER_WAIT_TIME = 8
TEST_DURATION = 10
SERVER_DURATION = SERVER_WAIT_TIME + TEST_DURATION + 30
LATENCY_TEST_DURATION = 30
TEST_COOLDOWN_TIME = 2

# Concurrency
DEFAULT_MAX_CONCURRENT = 10
BASE_PORT = 12400
