#!/usr/bin/env python3
"""Exact camera-visible original attributes for bounded v29 source review.

The existing reviewed conservative culler and HFM verifier are reused unchanged.
No delivered mesh is edited by this diagnostic.
"""
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT/'scripts/cleanup-v28'))
source = (ROOT/'scripts/cleanup-v29-right/cache_geometry.py').read_text()
source = source.replace("Path('/workspace/data/cleanup-v29-right/camera-geometry')", "Path('/workspace/data/cleanup-v30-left/camera-geometry')")
source = source.replace("ROOT/'scripts/cleanup-v29-right/review-cameras.json'", "ROOT/'scripts/cleanup-v30-left/review-cameras.json'")
exec(compile(source, str(ROOT/'scripts/cleanup-v29-right/cache_geometry.py'), 'exec'))
