#!/usr/bin/env python3
"""Locally compiled, fixed-iteration float32 3-D Chambolle TV filter.

The call signature matches the supported subset of skimage's
``denoise_tv_chambolle``. Input must already be float32 in raw intensity units;
only ``eps=0`` and ``channel_axis=None`` are supported. Compilation uses the
local C compiler, makes no downloads, and caches the library outside the repo.
The shared library releases the Python GIL through ctypes.CDLL.
"""
from __future__ import annotations

import ctypes
import hashlib
import math
import os
from pathlib import Path
import platform
import shlex
import subprocess
import tempfile
import threading

import numpy as np


_SOURCE = Path(__file__).with_suffix('.c')
_FLAGS = (
    '-O3', '-std=c11', '-fPIC', '-shared', '-march=native',
    '-fno-fast-math', '-ffp-contract=off', '-fexcess-precision=standard',
    '-fno-math-errno',
)
_LIB = None
_BUILD_LOCK = threading.Lock()


def _load():
    global _LIB
    if _LIB is not None:
        return _LIB
    with _BUILD_LOCK:
        if _LIB is not None:
            return _LIB
        compiler = shlex.split(os.environ.get('CC', 'cc'))
        if not compiler:
            raise RuntimeError('CC must name a local C compiler')
        identity = (
            _SOURCE.read_bytes()
            + repr((_FLAGS, compiler, platform.machine(), platform.processor())).encode()
        )
        digest = hashlib.sha256(identity).hexdigest()[:24]
        cache = Path(os.environ.get('HEART_TV_KERNEL_CACHE', tempfile.gettempdir()))
        cache = cache / ('heart-tv-kernel-' + str(os.getuid()))
        cache.mkdir(mode=0o700, parents=True, exist_ok=True)
        library = cache / (digest + '.so')
        if not library.exists():
            fd, pending = tempfile.mkstemp(prefix=digest + '-', suffix='.so', dir=cache)
            os.close(fd)
            try:
                command = [*compiler, *_FLAGS, str(_SOURCE), '-o', pending, '-lm']
                subprocess.run(command, check=True, capture_output=True, text=True)
                os.replace(pending, library)
            except subprocess.CalledProcessError as exc:
                raise RuntimeError('Local TV kernel compilation failed: ' + exc.stderr) from exc
            finally:
                if os.path.exists(pending):
                    os.unlink(pending)
        lib = ctypes.CDLL(str(library))
        pointer = ctypes.POINTER(ctypes.c_float)
        lib.heart_tv_chambolle_f32.argtypes = [
            pointer, pointer,
            ctypes.c_size_t, ctypes.c_size_t, ctypes.c_size_t,
            ctypes.c_uint, ctypes.c_float, ctypes.c_float,
        ]
        lib.heart_tv_chambolle_f32.restype = ctypes.c_int
        _LIB = lib
        return lib


def denoise_tv_chambolle(image, weight=800.0, eps=0.0, max_num_iter=16, *, channel_axis=None):
    """Return the reference fixed-iteration float32 3-D TV denoised field.

    ``max_num_iter`` includes reference iteration zero, whose primal field is
    the input. The returned field therefore depends on at most
    ``max_num_iter - 1`` nearest-neighbor dual/divergence rounds. A halo of
    ``max_num_iter`` native samples is the conservative tiling convention.
    The input is never modified. Integer-to-float normalization is deliberately
    unsupported: callers provide raw float32 intensities explicitly.
    """
    if eps != 0 or channel_axis is not None:
        raise ValueError('The compiled TV kernel requires eps=0 and channel_axis=None')
    array = np.asarray(image)
    if array.dtype != np.dtype(np.float32) or array.ndim != 3:
        raise TypeError('The compiled TV kernel requires a 3-D float32 array')
    if any(d == 0 for d in array.shape):
        raise ValueError('TV input dimensions must be nonzero')
    weight = float(weight)
    if not math.isfinite(weight) or weight <= 0:
        raise ValueError('TV weight must be finite and positive')
    iterations = int(max_num_iter)
    if iterations != max_num_iter or not 1 <= iterations <= 0xFFFFFFFF:
        raise ValueError('max_num_iter must be a positive uint32 iteration count')
    if not np.isfinite(array).all():
        raise ValueError('TV input must contain only finite raw intensities')
    array = np.ascontiguousarray(array)
    output = np.empty_like(array)
    pointer = ctypes.POINTER(ctypes.c_float)
    # NumPy casts Python scalar multipliers to float32 separately. In
    # particular, (1/6)/weight is evaluated in double before this cast.
    tau = np.float32(1.0 / 6.0)
    norm_scale = np.float32((1.0 / 6.0) / weight)
    lib = _load()
    status = lib.heart_tv_chambolle_f32(
        array.ctypes.data_as(pointer), output.ctypes.data_as(pointer),
        *array.shape, iterations, float(tau), float(norm_scale),
    )
    if status == -2:
        raise MemoryError('Unable to allocate the three float32 TV dual arrays')
    if status:
        raise ValueError('Unsupported TV kernel geometry or scalar parameters')
    return output


def kernel_metadata():
    """Reproducibility metadata; calling this also builds/verifies the library."""
    lib = _load()
    return {
        'reference': 'skimage.restoration._denoise_tv_chambolle_nd, scikit-image 0.26.0',
        'sourceSha256': hashlib.sha256(_SOURCE.read_bytes()).hexdigest(),
        'compileFlags': list(_FLAGS),
        'library': str(lib._name),
        'floatType': 'IEEE-754 binary32',
        'workspaceFloat32Arrays': 3,
        'outputFloat32Arrays': 1,
        'convergenceEnergyEvaluated': False,
        'lastUnusedDualUpdateEvaluated': False,
    }
