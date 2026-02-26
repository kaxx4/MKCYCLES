"""
Shared pytest fixtures.

The test_integration.py module sets environment variables before importing
the app – this conftest is intentionally minimal to avoid import-order issues.
"""
import os
import sys

# Ensure app package is importable when running pytest from project root
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
