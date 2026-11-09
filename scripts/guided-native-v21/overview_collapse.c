/* Display-LOD-only constrained filtering of proposed QEM edge collapses.
 * Geometry and QEM arithmetic remain in the installed replay implementation.
 * This filter uses bounded integer incidence arrays, never Python edge sets.
 */
#include <stdint.h>
#include <stddef.h>
#include <stdlib.h>

#define NONE UINT32_MAX

static uint32_t root(uint32_t *parent, uint32_t value) {
    uint32_t r = value;
    while (parent[r] != r) r = parent[r];
    while (parent[value] != value) {
        uint32_t next = parent[value];
        parent[value] = r;
        value = next;
    }
    return r;
}

/* stats: accepted, fixed rejection, cell rejection, nonedge rejection,
 * already merged, incidence visits. Return <0 for invalid input/allocation.
 */
int64_t overview_filter_collapses(uint32_t nv, uint32_t nf,
        const uint32_t *faces, uint32_t np, const uint32_t *proposals,
        const uint8_t *fixed, const uint64_t *cell,
        uint32_t *accepted, uint32_t *parent, uint64_t *stats) {
    if (nf > UINT32_MAX/3 || !nv) return -1;
    size_t ni = (size_t)nf*3;
    uint32_t *head = malloc((size_t)nv*sizeof(*head));
    uint32_t *tail = malloc((size_t)nv*sizeof(*tail));
    uint32_t *length = calloc(nv,sizeof(*length));
    uint32_t *next = malloc((ni ? ni : 1)*sizeof(*next));
    if (!head || !tail || !length || !next) {
        free(head); free(tail); free(length); free(next); return -2;
    }
    for (uint32_t i=0;i<nv;i++) { head[i]=tail[i]=NONE; parent[i]=i; }
    for (int i=0;i<6;i++) stats[i]=0;
    for (size_t i=0;i<ni;i++) {
        uint32_t v=faces[i];
        if (v>=nv) { free(head);free(tail);free(length);free(next);return -3; }
        next[i]=head[v]; head[v]=(uint32_t)i;
        if (tail[v]==NONE) tail[v]=(uint32_t)i;
        length[v]++;
    }
    for (uint32_t i=0;i<np;i++) {
        uint32_t pa=proposals[(size_t)i*2],pb=proposals[(size_t)i*2+1];
        if (pa>=nv || pb>=nv) { free(head);free(tail);free(length);free(next);return -4; }
        uint32_t a=root(parent,pa),b=root(parent,pb);
        if (a==b) { stats[4]++;continue; }
        if (fixed[a] || fixed[b]) { stats[1]++;continue; }
        /* Every prior accepted union had this same cell identity. */
        if (cell[a]!=cell[b]) { stats[2]++;continue; }
        uint32_t scan=length[a]<=length[b] ? a:b;
        int edge=0;
        for (uint32_t at=head[scan];at!=NONE;at=next[at]) {
            stats[5]++;
            size_t f=((size_t)at/3)*3;
            uint32_t x=root(parent,faces[f]);
            uint32_t y=root(parent,faces[f+1]);
            uint32_t z=root(parent,faces[f+2]);
            if (x==y || y==z || z==x) continue;
            if ((x==a || y==a || z==a) && (x==b || y==b || z==b)) {
                edge=1;break;
            }
        }
        if (!edge) { stats[3]++;continue; }
        size_t out=(size_t)stats[0]*2;
        accepted[out]=a;accepted[out+1]=b;stats[0]++;
        /* Append original incidence lists. Mapping each original triangle via
         * current roots gives exact adjacency after the accepted subsequence.
         * Degenerate mapped triangles are ignored by the next edge test.
         */
        if (head[b]!=NONE) {
            if (head[a]==NONE) head[a]=head[b];
            else next[tail[a]]=head[b];
            tail[a]=tail[b];
        }
        length[a]+=length[b];length[b]=0;head[b]=tail[b]=NONE;
        parent[b]=a;
    }
    for (uint32_t i=0;i<nv;i++) parent[i]=root(parent,i);
    int64_t result=(int64_t)stats[0];
    free(head);free(tail);free(length);free(next);
    return result;
}
