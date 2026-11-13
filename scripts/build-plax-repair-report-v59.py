#!/usr/bin/env python3
"""Build a self-contained HTML report for the one-view PLAX mitral repair.

Uses the existing standard-library Markdown renderer. Only the project's own
hash-verified v58/v59 WebP files are embedded; source figures are linked.

  python3 scripts/build-plax-repair-report-v59.py --html /absolute/repair.html
"""
import argparse
import base64
from collections import Counter
import hashlib
from html.parser import HTMLParser
import importlib.util
import json
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location('artwork_audit_renderer', ROOT / 'scripts/build-reference-audit-report-v58.py')
RENDER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(RENDER)
esc, require = RENDER.esc, RENDER.require


def sha(data):
    return hashlib.sha256(data).hexdigest()


def markdown(text):
    rendered = RENDER.markdown_html(text)
    for label, target in re.findall(r'\[([^\]\n]+)\]\((PROMPT\.md|GUIDELINES\.md)\)', text):
        anchor = 'exact-prompt' if target == 'PROMPT.md' else 'guidelines'
        rendered = rendered.replace(RENDER.inline_markdown(f'[{label}]({target})'),
                                    f'<a href="#{anchor}">{esc(label)}</a>')
    return rendered


def inputs(root):
    directory = root / 'docs/reference-views-v59'
    data = (directory / 'asset-manifest.json').read_bytes()
    manifest = json.loads(data)
    require(manifest.get('revision') == 59 and manifest.get('review_state') == 'complete', 'A completed v59 manifest is required')
    require(manifest.get('count') == len(manifest.get('entries', [])) == 56, 'Expected the complete 56-view registry')
    require(manifest.get('review_scope', {}).get('newly_reviewed') == ['tte:plax_mv'], 'This report covers only the targeted PLAX review')
    selected = [e for e in manifest['entries'] if e.get('mode') == 'tte' and e.get('id') == 'plax_mv']
    require(len(selected) == 1, 'Expected exactly one PLAX mitral entry')
    entry = selected[0]
    review = entry['review']
    require(entry.get('disposition') == 'replace' and review.get('status') == 'pass', 'The selected replacement has not passed review')
    require(not review.get('hard_failures'), 'The selected replacement has an unresolved failure')
    require(all(review.get('checks', {}).get(gate) is True for gate in RENDER.CHECKS), 'Incomplete review gates')
    require(review.get('export_review', {}).get('status') == 'pass', 'Actual encoded-export review is required')
    for role in ('image', 'thumbnail'):
        require(review['export_review'].get(role + '_sha256') == entry[role]['sha256'], 'Export review refers to different image bytes')
    baseline = (root / 'docs/reference-views-v58/asset-manifest.json').read_bytes()
    require(sha(baseline) == manifest.get('historical_manifest_sha256'), 'Historical manifest checksum changed')
    old_entries = json.loads(baseline)['entries']
    old = next(e for e in old_entries if e['mode'] == 'tte' and e['id'] == 'plax_mv')
    require(entry['previous_image'] == old['image'] and entry['previous_thumbnail'] == old['thumbnail'], 'Before-image identity changed')
    require([e for e in manifest['entries'] if e is not entry] ==
            [e for e in old_entries if not (e['mode'] == 'tte' and e['id'] == 'plax_mv')], 'A carried-over entry changed')
    images = {}
    for role in ('previous_image', 'image', 'previous_thumbnail', 'thumbnail'):
        meta = entry[role]
        revision = 58 if role.startswith('previous_') else 59
        thumb = role.endswith('thumbnail')
        expected = f'public/assets/reference-views-v{revision}/{"thumbs/" if thumb else ""}tte-plax_mv.webp'
        require(meta.get('path') == expected, 'Only matching project PLAX artwork may be embedded')
        path = root / expected
        require(path.is_file() and not path.is_symlink(), 'Missing regular project artwork')
        content = path.read_bytes()
        require(len(content) == meta['bytes'] and sha(content) == meta['sha256'], 'Artwork byte/hash mismatch')
        require(content[:4] == b'RIFF' and content[8:12] == b'WEBP', 'Unexpected artwork encoding')
        require(meta.get('width') == meta.get('height') == (384 if thumb else 960), 'Unexpected artwork dimensions')
        images[role] = content
    guidelines = (directory / 'GUIDELINES.md').read_text()
    prompt_document = (directory / 'PROMPT.md').read_text()
    prompt = entry['generation']['prompt']
    require(prompt in prompt_document, 'PROMPT.md does not contain the exact accepted generation prompt')
    hashes = {'Manifest SHA-256': sha(data), 'Historical manifest SHA-256': sha(baseline),
              'Guidelines SHA-256': sha(guidelines.encode()), 'Prompt document SHA-256': sha(prompt_document.encode()),
              'Accepted generation master SHA-256': entry['source_png_sha256']}
    return entry, images, guidelines, prompt_document, hashes


def picture(images, role, size, caption, class_name=''):
    source_size = 384 if role.endswith('thumbnail') else 960
    data = base64.b64encode(images[role]).decode('ascii')
    return (f'<figure class="repair-figure {class_name}"><img src="data:image/webp;base64,{data}" '
            f'width="{source_size}" height="{source_size}" style="width:{size}px" loading="lazy" '
            f'alt="{esc(caption)}"><figcaption>{esc(caption)}</figcaption></figure>')


def build(entry, images, guidelines, prompt_document, hashes):
    review = entry['review']
    observations = ''.join('<tr><th scope="row">' + esc(RENDER.title(gate)) + '</th><td>' + esc(finding) + '</td></tr>'
                           for gate, finding in review['gate_findings'].items())
    assets = []
    for role, label in [('previous_image', 'Before · v58 illustration'), ('image', 'After · v59 illustration'),
                        ('previous_thumbnail', 'Before · v58 thumbnail'), ('thumbnail', 'After · v59 thumbnail')]:
        meta = entry[role]
        assets.append('<tr><th scope="row">' + esc(label) + '</th><td><code>' + esc(meta['path']) + '</code></td>'
                      f'<td>{meta["width"]} × {meta["height"]}<br>{meta["bytes"]:,} bytes</td>'
                      '<td><code>' + esc(meta['sha256']) + '</code></td></tr>')
    provenance = {k: v for k, v in entry['generation'].items() if k not in ('prompt', 'prompt_history')}
    history = entry['generation'].get('prompt_history', [])
    if history and history != [entry['generation']['prompt']]:
        provenance['prompt_history'] = history
    style = RENDER.CSS + '''
main{max-width:1120px}.repair-section{margin:28px 0;padding:28px;background:var(--card);border:1px solid var(--line);border-radius:14px}
.repair-section h2{margin-bottom:18px}.repair-section h3{margin-top:30px}.before-after{display:grid;grid-template-columns:1fr 1fr;gap:24px}.before-after>div{min-width:0}
.repair-figure{max-width:100%;margin:0}.repair-figure img{max-width:100%;height:auto;display:block;border:1px solid #dedbd2;border-radius:9px;background:#f6f3ee}.repair-figure figcaption{max-width:70ch;margin-top:10px}
.scale-pair{display:grid;grid-template-columns:minmax(0,1.4fr) minmax(0,1fr);gap:30px;align-items:start}.scale-pair>div{min-width:0}.observations th{width:24%;font-weight:650}.observations td{font-size:.95rem}.assets-table{table-layout:fixed;font-size:.79rem}.assets-table th:first-child{width:20%}.assets-table th:nth-child(2){width:28%}.assets-table th:nth-child(3){width:15%}.assets-table th:nth-child(4){width:37%}
.intro-note{max-width:850px}.document-content{overflow-wrap:anywhere}.document-content>h3:first-child{margin-top:12px}.repair-section:target{scroll-margin-top:18px}
@media(max-width:700px){.repair-section{padding:20px}.before-after,.scale-pair{grid-template-columns:1fr;gap:25px}.assets-table{min-width:680px}.observations th{width:29%}}
@media print{.repair-section{padding:16px}.before-after{grid-template-columns:1fr 1fr}.scale-pair{grid-template-columns:1fr 1fr}.assets-table{min-width:0}.repair-figure{break-inside:avoid}}
'''
    return '\n'.join([
        '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">',
        '<meta name="description" content="Targeted source-based visual review of the Heart Explorer PLAX mitral illustration: atrial wall, inflow and outflow repair.">',
        '<title>Heart Explorer · PLAX Mitral Repair · v59</title><style>' + style + '</style></head><body><main>',
        '<header><span class="eyebrow">Heart Explorer · TTE reference artwork · Revision 59</span><h1>PLAX mitral illustration<br>wall and outflow repair</h1>',
        '<p class="lead intro-note">A targeted follow-up to the left atrial wall and LVOT ambiguity in the previous illustration. '
        'The corrected image preserves an open mitral annulus while showing the atrial tissue band and distinct outflow boundaries.</p>',
        '<p class="small muted">November 12, 2026 · America/Chicago · ASE Table 2, view 2.4</p>',
        '<div class="notice"><strong>Review scope.</strong> Source-based AI visual QC of an educational schematic; no independent clinician sign-off. '
        'Only <code>tte:plax_mv</code> receives a new review. The other 55 illustration records and bytes are carried over unchanged.</div>',
        '<nav class="quick-links" aria-label="Report sections"><a href="#comparison">Before and after</a><a href="#scales">Export sizes</a><a href="#findings">Observed findings</a><a href="#guidelines">Full guidelines</a><a href="#exact-prompt">Exact prompt</a><a href="#integrity">Sources and hashes</a></nav></header>',
        '<section id="comparison" class="repair-section"><h2>Before and after</h2><div class="before-after"><div><span class="figure-label">Before · superseded v58</span>',
        picture(images, 'previous_image', 960, 'Original v58 project illustration. This PLAX assessment is superseded by the targeted follow-up.'),
        '</div><div><span class="figure-label">After · accepted v59</span>',
        picture(images, 'image', 960, 'Current v59 project illustration. LA wall, open mitral inflow and LVOT/root relationships were reviewed together.'),
        '</div></div><h3>Why another repair was needed</h3>' + RENDER.html_value(review['original_findings']),
        '<p class="notice">' + esc(review['prior_review_correction']) + '</p></section>',
        '<section id="scales" class="repair-section"><h2>Inspect the actual encoded exports</h2><p>These are the same WebP bytes used in the application. '
        'The large export is shown at up to 960 CSS pixels, followed by the 384-pixel thumbnail and a 200-pixel display of that same thumbnail. '
        'Narrow screens reduce an image to the available width; the report does not crop or create new artwork.</p><h3>960 px illustration</h3>',
        picture(images, 'image', 960, '960 × 960 WebP export. Use the enlarged illustration to inspect cusp morphology, separate hinge levels and the short fibrous curtain.'),
        '<div class="scale-pair"><div><h3>384 px thumbnail</h3>',
        picture(images, 'thumbnail', 384, '384 × 384 WebP thumbnail, shown at its native CSS width where the layout permits.'),
        '</div><div><h3>200 px gallery display</h3>',
        picture(images, 'thumbnail', 200, 'The encoded 384 px thumbnail displayed at 200 CSS pixels. No separate generated or retouched image is used.'),
        '</div></div></section>',
        '<section id="findings" class="repair-section"><h2>Observed review findings</h2><p>' + esc(review['summary']) + '</p>',
        '<div class="table-scroll"><table class="observations"><thead><tr><th scope="col">Gate</th><th scope="col">Observed pixels</th></tr></thead><tbody>' + observations + '</tbody></table></div>',
        '<h3>Phase and limitations</h3><p>' + esc(review['phase']) + '</p>' + RENDER.html_value(review['limitations']),
        '<h3>Inspection scope</h3><p>' + esc(review['independent_review']) + '</p>' + RENDER.html_value(review['inspection']),
        '<details class="subsection"><summary>Actual encoded-export findings and identity</summary>' + RENDER.html_value(review['export_review']) + '</details></section>',
        '<section id="guidelines" class="repair-section"><span class="eyebrow">Complete document</span><h2>Targeted repair guidelines</h2><div class="document-content">',
        markdown(guidelines), '</div></section>',
        '<section id="exact-prompt" class="repair-section"><span class="eyebrow">Complete document · verbatim generation instructions</span><h2>Exact accepted prompt</h2><div class="document-content">',
        markdown(prompt_document), '</div></section>',
        '<section id="integrity" class="repair-section"><h2>Sources and file identity</h2><p>Published anatomy, ultrasound and CT figures were used as references. '
        'They are linked below and are not embedded in this report. Source roles distinguish primary TTE orientation evidence from supplementary attachment anatomy.</p>',
        RENDER.html_value(review['sources']),
        '<h3>Project artwork</h3><div class="table-scroll"><table class="assets-table"><thead><tr><th scope="col">Asset</th><th scope="col">Repository path</th><th scope="col">Dimensions / bytes</th><th scope="col">SHA-256</th></tr></thead><tbody>',
        *assets, '</tbody></table></div><h3>Report inputs</h3><dl class="manifest-hashes">',
        *['<dt>' + esc(label) + '</dt><dd><code>' + esc(value) + '</code></dd>' for label, value in hashes.items()],
        '</dl><details class="subsection"><summary>Generation provenance and input-reference hashes</summary>' + RENDER.html_value(provenance) + '</details></section>',
        '<footer><p>All embedded artwork was checked against the recorded byte counts and SHA-256 hashes. '
        'This establishes file identity, separately from the recorded visual anatomy review. The report is self-contained and has no external image, stylesheet or script dependency.</p>'
        '<p>Source-based AI visual QC of educational artwork; no independent clinician sign-off or diagnostic validation is implied.</p></footer></main></body></html>',
    ])


def validate_html(document, images, prompt):
    class Inspect(HTMLParser):
        def __init__(self):
            super().__init__()
            self.images, self.scripts, self.links, self.ids = [], [], [], set()

        def handle_starttag(self, tag, attrs):
            values = dict(attrs)
            if tag == 'img':
                self.images.append(values.get('src', ''))
            if tag == 'script':
                self.scripts.append(values)
            if tag == 'link':
                self.links.append(values)
            if 'id' in values:
                self.ids.add(values['id'])
    parsed = Inspect()
    parsed.feed(document)
    expected = Counter(sha(images[role]) for role in ('previous_image', 'image', 'image', 'thumbnail', 'thumbnail'))
    actual = []
    for source in parsed.images:
        require(source.startswith('data:image/webp;base64,'), 'A nonembedded image entered the report')
        actual.append(sha(base64.b64decode(source.split(',', 1)[1], validate=True)))
    require(Counter(actual) == expected, 'Embedded artwork differs from the expected bytes')
    require(not parsed.scripts and not parsed.links, 'Unexpected script or linked stylesheet dependency')
    require(esc(prompt) in document, 'The exact prompt was not preserved in rendered HTML')
    require(not re.search(r'(?:file://|sandbox:|/(?:workspace|mnt/data|home|tmp)/)', document), 'An absolute local path entered the report')
    require({'comparison', 'scales', 'findings', 'guidelines', 'exact-prompt', 'integrity'} <= parsed.ids, 'Missing report section')
    return {'embedded_images': len(actual), 'unique_artwork_images': len(set(actual)),
            'embedded_hashes_verified': True, 'exact_prompt_preserved': True,
            'absolute_local_paths': 0, 'external_image_style_script_dependencies': 0,
            'browser_visual_check': 'not performed by this generator'}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--html', type=Path, required=True, help='Absolute output HTML path')
    parser.add_argument('--root', type=Path, default=ROOT, help='Repository root')
    args = parser.parse_args()
    try:
        require(args.html.is_absolute(), '--html must be an absolute path')
        root = args.root.resolve()
        protected = {root / 'docs/reference-views-v59' / name for name in ('asset-manifest.json', 'GUIDELINES.md', 'PROMPT.md')}
        require(args.html.resolve() not in protected, 'The report must not overwrite an input document')
        entry, images, guidelines, prompt_document, hashes = inputs(root)
        document = build(entry, images, guidelines, prompt_document, hashes)
        checks = validate_html(document, images, entry['generation']['prompt'])
        RENDER.atomic_write(args.html, document)
        print(json.dumps({'html': str(args.html), 'bytes': len(document.encode()), 'sha256': sha(document.encode()),
                          'newly_reviewed': 'tte:plax_mv', 'carried_over_unchanged': 55, **checks}, indent=2))
    except (OSError, ValueError, KeyError, TypeError, json.JSONDecodeError) as error:
        parser.exit(1, f'Cannot build PLAX repair report: {error}\n')
