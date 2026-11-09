/*
 * Fixed-iteration, float32 3-D Chambolle TV denoising.
 *
 * Numerical reference: skimage.restoration._denoise_tv_chambolle_nd in
 * scikit-image 0.26.0, with eps=0 and channel_axis=None. The energy never
 * affects a finite-input eps=0 iteration count, and is not evaluated here.
 * The last dual update is also unused by the returned primal field.
 *
 * Preserve the reference's axis order (Z, Y, X), operation order, float32
 * rounding, zero forward gradients at the upper boundary, and return point.
 * Compile WITHOUT fast-math, contraction/FMA, or reassociation. The Python
 * wrapper supplies the two separately rounded scalar multipliers.
 *
 * Workspace: three float32 dual arrays; output is supplied by the caller.
 * No gradient, divergence, norm, energy, or per-iteration temporary arrays.
 */

#include <math.h>
#include <stddef.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>

#if defined(__STDC_VERSION__) && __STDC_VERSION__ >= 199901L
#define TV_RESTRICT restrict
#else
#define TV_RESTRICT
#endif

/* A separate pass makes all divergence reads precede every dual write. */
static void primal_update(const float *TV_RESTRICT image,
                          float *TV_RESTRICT out,
                          const float *TV_RESTRICT pz,
                          const float *TV_RESTRICT py,
                          const float *TV_RESTRICT px,
                          size_t nz, size_t ny, size_t nx)
{
    const size_t plane = ny * nx;
    for (size_t z = 0; z < nz; ++z) {
        for (size_t y = 0; y < ny; ++y) {
            const size_t row = (z * ny + y) * nx;
            for (size_t x = 0; x < nx; ++x) {
                const size_t i = row + x;
                /* np.sum(..., axis=0) reduces axes in this order. */
                float sum = 0.0f + pz[i];
                sum = sum + py[i];
                sum = sum + px[i];
                float d = -sum;
                if (z != 0) d = d + pz[i - plane];
                if (y != 0) d = d + py[i - nx];
                if (x != 0) d = d + px[i - 1];
                out[i] = image[i] + d;
            }
        }
    }
}

/* Gradients, norm, and all three dual updates share one local traversal. */
static void dual_update(const float *TV_RESTRICT out,
                        float *TV_RESTRICT pz,
                        float *TV_RESTRICT py,
                        float *TV_RESTRICT px,
                        size_t nz, size_t ny, size_t nx,
                        float tau, float norm_scale)
{
    const size_t plane = ny * nx;
    for (size_t z = 0; z < nz; ++z) {
        for (size_t y = 0; y < ny; ++y) {
            const size_t row = (z * ny + y) * nx;
            for (size_t x = 0; x < nx; ++x) {
                const size_t i = row + x;
                const float center = out[i];
                const float gz = z + 1 < nz ? out[i + plane] - center : 0.0f;
                const float gy = y + 1 < ny ? out[i + nx] - center : 0.0f;
                const float gx = x + 1 < nx ? out[i + 1] - center : 0.0f;
                float norm2 = 0.0f + gz * gz;
                norm2 = norm2 + gy * gy;
                norm2 = norm2 + gx * gx;
                float norm = sqrtf(norm2);
                norm = norm * norm_scale;
                norm = norm + 1.0f;
                const float dz = tau * gz;
                const float dy = tau * gy;
                const float dx = tau * gx;
                pz[i] = (pz[i] - dz) / norm;
                py[i] = (py[i] - dy) / norm;
                px[i] = (px[i] - dx) / norm;
            }
        }
    }
}

/* Return 0 on success, -1 for geometry/parameters, -2 for allocation failure. */
int heart_tv_chambolle_f32(const float *TV_RESTRICT image,
                           float *TV_RESTRICT out,
                           size_t nz, size_t ny, size_t nx,
                           unsigned int iterations,
                           float tau, float norm_scale)
{
    if (!image || !out || !nz || !ny || !nx || !iterations ||
        !(tau > 0.0f) || !(norm_scale > 0.0f) ||
        !isfinite(tau) || !isfinite(norm_scale)) return -1;
    if (ny > SIZE_MAX / nx || nz > SIZE_MAX / (ny * nx)) return -1;
    const size_t n = nz * ny * nx;
    if (n > SIZE_MAX / (3 * sizeof(float))) return -1;
    if (iterations == 1) {
        memcpy(out, image, n * sizeof(float));
        return 0;
    }
    float *p = (float *)calloc(3 * n, sizeof(float));
    if (!p) return -2;
    float *pz = p;
    float *py = p + n;
    float *px = p + 2 * n;

    /* Reference iteration 0 returns the original image to the dual update. */
    dual_update(image, pz, py, px, nz, ny, nx, tau, norm_scale);
    for (unsigned int iteration = 1; iteration < iterations; ++iteration) {
        primal_update(image, out, pz, py, px, nz, ny, nx);
        if (iteration + 1 < iterations)
            dual_update(out, pz, py, px, nz, ny, nx, tau, norm_scale);
    }
    free(p);
    return 0;
}
