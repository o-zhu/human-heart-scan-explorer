#!/usr/bin/env python3
"""Build a self-contained, filterable comparison report from the v60 manifest.

Only hash-verified original project artwork is embedded. Published medical
source figures are linked/cited, never copied into the report.
"""
import argparse
import base64
import hashlib
from html import escape
import importlib.util
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DIRECTORY = ROOT / 'docs/reference-views-v60'
DOMAINS = ('view', 'topology', 'walls', 'valves', 'attachments', 'labels', 'style', 'thumbnail')


def sha(data):
    return hashlib.sha256(data).hexdigest()


def require(condition, message):
    if not condition:
        raise ValueError(message)


def text(value):
    return escape(str(value), quote=True)


def display(value):
    return value if isinstance(value, str) else json.dumps(value, ensure_ascii=False, indent=2)


def verified_image(meta, cache):
    key = meta['sha256']
    if key not in cache:
        path = ROOT / meta['path']
        require(path.is_file() and not path.is_symlink(), 'Missing regular artwork file')
        data = path.read_bytes()
        require(sha(data) == key and len(data) == meta['bytes'], 'Artwork hash/size mismatch: ' + meta['path'])
        cache[key] = 'data:image/webp;base64,' + base64.b64encode(data).decode()
    return cache[key]


def sources_html(sources):
    return '<ul>' + ''.join('<li><a href="' + text(s['url']) + '" target="_blank" rel="noopener">' +
                            text(s.get('publication', s.get('source_id', s.get('primary_authors', 'Primary reference')))) +
                            '</a><span class="source-detail">' + text(', '.join(str(s[k]) for k in
                            ('table', 'row', 'view_number', 'printed_page', 'figure') if k in s)) + '</span></li>'
                            for s in sources) + '</ul>'


def initial_scores(review):
    initial = review['initial_audit']
    return initial.get('domain_scores', initial.get('scores_0_to_2', initial.get('scores', {})))


def defects(review):
    return review.get('original_findings') or review['initial_audit'].get('observed_defects') or []


def html_report(manifest, data):
    entries = manifest['entries']
    replacements = sum(e['disposition'] == 'replace' for e in entries)
    cache = {}
    css = '''
:root{color-scheme:light;--ink:#20362e;--paper:#f7f3ec;--muted:#596b61;--line:#cbd2c8;--accent:#a55342}
*{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);font:17px/1.55 system-ui,-apple-system,Segoe UI,sans-serif}
main{max-width:1280px;margin:auto;padding:48px 26px 80px}h1{font-size:clamp(32px,4vw,55px);line-height:1.08;letter-spacing:-.035em;margin:12px 0 24px}h2{line-height:1.2;margin:0 0 14px}h3{line-height:1.25}
a{color:#7d3d30;text-underline-offset:3px}.eyebrow{font-size:13px;letter-spacing:.16em;text-transform:uppercase;font-weight:750;color:var(--accent)}.lede{max-width:900px;font-size:20px}.muted{color:var(--muted)}
.metrics{display:grid;grid-template-columns:repeat(4,1fr);border-top:1px solid var(--line);border-bottom:1px solid var(--line);margin:30px 0}.metric{padding:20px 12px}.metric strong{font-size:35px;display:block}.metric span{font-size:14px}
.standard{padding:24px;border:1px solid var(--line);border-radius:12px;margin:24px 0;background:#fffdf9}.standard p:last-child{margin-bottom:0}.standard ul{padding-left:22px}
.toolbar{position:sticky;top:0;z-index:2;background:#f7f3ecf5;backdrop-filter:blur(8px);display:grid;grid-template-columns:1fr 170px 210px;gap:12px;padding:16px 0;border-bottom:1px solid var(--line)}input,select,button{font:inherit;color:inherit}input,select{padding:11px;border:1px solid #9aa99e;border-radius:7px;background:#fffdf9;width:100%}label{font-size:13px;font-weight:650;display:block}#visible-count{font-size:14px;margin:12px 0 24px}
.view{border:1px solid var(--line);border-radius:14px;background:#fffdf9;overflow:hidden;margin:26px 0}.view[hidden]{display:none}.view-head{padding:25px 28px 8px}.tag{display:inline-block;padding:3px 9px;font-size:12px;text-transform:uppercase;font-weight:750;letter-spacing:.08em;border-radius:20px;background:#e1ebe3;margin-right:8px}.tag.repaired{background:#f1ddd4;color:#783d30}.view h2{font-size:25px;margin:12px 0}.phase{font-size:15px;color:var(--muted)}
.pair{display:grid;grid-template-columns:1fr 1fr;gap:1px;background:var(--line);border-top:1px solid var(--line);border-bottom:1px solid var(--line)}figure{margin:0;background:#f7f3ec;padding:16px}figure img{width:100%;height:auto;display:block;cursor:zoom-in;aspect-ratio:1;object-fit:contain}figcaption{font-size:14px;padding:8px 3px;color:var(--muted)}.body{padding:22px 28px}.summary{font-size:18px}.finding{padding-left:18px;margin:8px 0}.scores{border-collapse:collapse;width:100%;font-size:14px;margin:15px 0}.scores td,.scores th{border-bottom:1px solid var(--line);padding:7px 10px;text-align:left}.scores th{font-weight:650}.scores td:not(:first-child){width:80px}.boundary{border-left:3px solid #b87b69;padding:2px 0 2px 14px;margin:14px 0}.boundary strong{display:block}.boundary p{margin:5px 0;font-size:15px}
details{border-top:1px solid var(--line);padding:14px 0}summary{cursor:pointer;font-weight:650}.source-detail{display:block;color:var(--muted);font-size:13px}pre{white-space:pre-wrap;overflow-wrap:anywhere;font:13px/1.6 ui-monospace,monospace;background:#f0eee7;padding:18px;border-radius:6px}.foot{font-size:13px;color:var(--muted);overflow-wrap:anywhere;margin-top:30px}dialog{padding:12px;border:1px solid var(--line);border-radius:10px;max-width:min(96vw,1060px);max-height:96vh;background:var(--paper)}dialog::backdrop{background:#0b171ed9}dialog img{max-width:100%;max-height:82vh;display:block;margin:auto}dialog button{float:right;padding:8px 16px;border:1px solid #9aa99e;background:white;border-radius:6px;cursor:pointer}#zoom-caption{margin:12px}
@media(max-width:650px){main{padding:28px 14px}.metrics{grid-template-columns:1fr 1fr}.toolbar{grid-template-columns:1fr 1fr}.search{grid-column:1/-1}.pair{grid-template-columns:1fr}.view-head,.body{padding:18px}.scores{font-size:12px}.scores td,.scores th{padding:6px}}
@media print{.toolbar,#visible-count,dialog{display:none}.view{break-inside:avoid}details{display:block}.pair{grid-template-columns:1fr 1fr}main{max-width:none}a{color:inherit}}
'''
    out = ['<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">',
           '<title>Heart Explorer · Full reference illustration QC · v60</title><style>' + css + '</style><body><main>',
           '<header><div class="eyebrow">Heart Explorer / Reference illustration review / v60</div>',
           '<h1>Every wall. Every junction.<br>Every reference view.</h1>',
           '<p class="lede">A fresh source-based review of all 28 TTE and 28 TEE illustrations, with targeted repairs for missing tissue bands, unclear valve geometry, incorrect connections and incomplete labels.</p>',
           '<div class="metrics"><div class="metric"><strong>56</strong><span>Illustrations freshly reviewed</span></div>',
           f'<div class="metric"><strong>{replacements}</strong><span>Illustrations repaired</span></div><div class="metric"><strong>{56-replacements}</strong><span>Original assets retained after review</span></div>',
           '<div class="metric"><strong>8</strong><span>Independent grading domains</span></div></div></header>',
           '<section class="standard"><h2>The acceptance rule</h2><p>Each applicable domain must be clear and supported. A missing wall, incorrect connection, uncertain valve relationship or materially missing label blocks acceptance, regardless of the total score.</p>',
           '<ul><li>Trace every visible muscular, vascular and fibrous boundary separately.</li><li>Check valve direction relative to ventricular and arterial sides, with a recorded phase.</li><li>Inspect actual 960px images, 384px exports and 200px renderings; bind each review to those exported bytes.</li><li>Retain rejected attempts and explain the defect that required another edit.</li></ul>',
           '<p class="muted">Scores describe the quality of these simplified teaching schematics. They are not a clinical accuracy percentage. Reviews are AI-assisted; independent clinician certification, patient correspondence and validation of valve motion are not claimed.</p></section>',
           '<div class="toolbar"><label class="search">Find a view<input id="search" type="search" placeholder="PLAX, atrial wall, pulmonary valve…"></label>',
           '<label>Approach<select id="mode"><option value="all">All approaches</option><option value="tte">TTE</option><option value="tee">TEE</option></select></label>',
           '<label>Disposition<select id="disposition"><option value="all">All illustrations</option><option value="replace">Repaired</option><option value="retain">Retained after review</option></select></label></div>',
           '<p id="visible-count" aria-live="polite">56 illustrations</p>']
    markdown = ['# Heart Explorer: complete reference-illustration QC — v60', '',
                f'All **56** illustrations received a fresh review: **{replacements} repaired**, **{56-replacements} retained** after source and pixel inspection.', '',
                'The eight-domain score is a schematic-QC aid, not a clinical accuracy percentage. No independent clinician certification, patient correspondence or valve-motion validation is claimed.', '',
                'See [GUIDELINES.md](GUIDELINES.md) for the full detection and grading standard and [asset-manifest.json](asset-manifest.json) for exact provenance, attempts, reviews and hashes.', '',
                '| View | Disposition | Current score |', '| --- | --- | --- |']
    for e in entries:
        markdown.append(f"| {e['mode'].upper()} {e['view_number']} — {e['name']} | {'Repaired' if e['disposition']=='replace' else 'Retained after fresh review'} | {e['review']['total_score']}/16 |")
    markdown += ['', '## Per-view findings', '']
    for e in entries:
        review = e['review']
        repaired = e['disposition'] == 'replace'
        label = 'Repaired' if repaired else 'Retained after fresh review'
        search = ' '.join([e['mode'], e['id'], e['name'], review['summary'], display(defects(review))]).lower()
        out += ['<article class="view" data-mode="' + text(e['mode']) + '" data-disposition="' + text(e['disposition']) + '" data-search="' + text(search) + '">',
                '<div class="view-head"><span class="tag">' + text(e['mode'].upper()) + ' · ' + text(e['view_number']) + '</span><span class="tag ' + ('repaired' if repaired else '') + '">' + label + '</span>',
                '<h2>' + text(e['name']) + '</h2><p class="phase"><strong>Phase:</strong> ' + text(review['phase']) + '</p></div><div class="pair">']
        for role, caption in [('previous_image', 'Before · active v59 collection'), ('image', 'Current · ' + label.lower())]:
            alt = e['name'] + ' — ' + caption
            out += ['<figure><img loading="lazy" width="960" height="960" alt="' + text(alt) + '" src="' + verified_image(e[role], cache) + '"><figcaption>' + text(caption) + ' · click to enlarge</figcaption></figure>']
        out += ['</div><div class="body"><p class="summary">' + text(review['summary']) + '</p>']
        findings = defects(review)
        if findings:
            out += ['<h3>What the original failed</h3>']
            for finding in findings:
                value = finding.get('finding', finding.get('observation', finding.get('description', display(finding)))) if isinstance(finding, dict) else finding
                out += ['<p class="finding">' + text(value) + '</p>']
        else:
            out += ['<p class="muted">No blocking defect found in the fresh review. The original image bytes are retained.</p>']
        before = initial_scores(review)
        out += ['<details><summary>Grading and boundary inventory</summary><table class="scores"><thead><tr><th>Domain</th><th>Before</th><th>Current</th></tr></thead><tbody>']
        for domain in DOMAINS:
            out += ['<tr><td>' + text(domain.capitalize()) + '</td><td>' + text(before.get(domain, '—')) + '</td><td>' + text(review['domain_scores'][domain]) + '</td></tr>']
        out += ['</tbody></table>']
        for boundary in review['boundary_inventory']:
            if isinstance(boundary, dict):
                title = boundary.get('structure', boundary.get('boundary_class', boundary.get('classification', 'Boundary')))
                body = boundary.get('observation', boundary.get('description', display(boundary)))
            else:
                title, body = 'Boundary', boundary
            out += ['<div class="boundary"><strong>' + text(title) + '</strong><p>' + text(body) + '</p></div>']
        out += ['</details><details><summary>Sources and actual export review</summary>', sources_html(review['sources']),
                '<p>' + text(review['independent_review']) + '</p><p>' + text(display(review['export_review']['observations'])) + '</p>',
                '<pre>' + text(json.dumps({'image_sha256': e['image']['sha256'], 'thumbnail_sha256': e['thumbnail']['sha256']}, indent=2)) + '</pre></details>']
        if repaired:
            out += ['<details><summary>Exact accepted prompt and attempt history</summary><pre>' + text(e['generation']['prompt']) + '</pre><pre>' + text(json.dumps(e['generation']['attempts'], ensure_ascii=False, indent=2)) + '</pre></details>']
        out += ['<details><summary>Complete review record</summary><pre>' + text(json.dumps(review, ensure_ascii=False, indent=2)) + '</pre></details></div></article>']
        markdown += [f"### {e['mode'].upper()} {e['view_number']} — {e['name']}", '', f'**{label}.** {review["summary"]}', '',
                     f'**Phase:** {review["phase"]}', '', '| Before | Current |', '| --- | --- |',
                     f"| ![Before](../../{e['previous_image']['path']}) | ![Current](../../{e['image']['path']}) |", '']
        if findings:
            markdown += ['**Original findings:**', ''] + ['- ' + (f.get('finding', f.get('observation', f.get('description', display(f)))) if isinstance(f, dict) else f) for f in findings] + ['']
        markdown += ['**Independent inspection:** ' + review['independent_review'], '', '**Exported-pixel observations:** ' + display(review['export_review']['observations']), '',
                     '**Sources:**', ''] + ['- [' + s.get('publication', s.get('source_id', 'Primary reference')) + '](' + s['url'] + ')' for s in review['sources']] + ['']
    out += ['<footer class="foot">Manifest SHA-256: ' + sha(data) + '<br>Original project illustrations only. Published guideline figures are not embedded. Historical assets and manifests remain intact.</footer></main>',
            '<dialog id="zoom"><button id="close-zoom" type="button">Close</button><p id="zoom-caption"></p><img id="zoom-image" alt=""></dialog>',
            '''<script>
const cards=[...document.querySelectorAll('.view')],search=document.getElementById('search'),mode=document.getElementById('mode'),disposition=document.getElementById('disposition');
function filter(){const q=search.value.trim().toLowerCase();let n=0;for(const card of cards){const shown=(!q||card.dataset.search.includes(q))&&(mode.value==='all'||card.dataset.mode===mode.value)&&(disposition.value==='all'||card.dataset.disposition===disposition.value);card.hidden=!shown;if(shown)n++;}document.getElementById('visible-count').textContent=n+' of 56 illustrations';}
for(const control of [search,mode,disposition])control.addEventListener('input',filter);
const dialog=document.getElementById('zoom'),zoom=document.getElementById('zoom-image');
for(const image of document.querySelectorAll('figure img')){image.tabIndex=0;const open=()=>{zoom.src=image.src;zoom.alt=image.alt;document.getElementById('zoom-caption').textContent=image.alt;dialog.showModal();};image.addEventListener('click',open);image.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();open();}});}
document.getElementById('close-zoom').addEventListener('click',()=>dialog.close());
</script></body></html>''']
    return '\n'.join(out) + '\n', '\n'.join(markdown) + '\n'


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--html', required=True, type=Path)
    parser.add_argument('--markdown', type=Path, default=DIRECTORY / 'AUDIT.md')
    args = parser.parse_args()
    path = DIRECTORY / 'asset-manifest.json'
    data = path.read_bytes()
    manifest = json.loads(data)
    spec = importlib.util.spec_from_file_location('reference_icons_v60', ROOT / 'scripts/prepare-reference-icons-v60.py')
    verifier = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(verifier)
    baseline_data, baseline_manifest = verifier.baseline()
    verifier.validate_manifest(manifest, baseline_data, baseline_manifest)
    html, markdown = html_report(manifest, data)
    for destination, content in [(args.html, html), (args.markdown, markdown)]:
        require(destination.resolve() not in {path.resolve(), (DIRECTORY / 'GUIDELINES.md').resolve()}, 'Do not overwrite source evidence')
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_text(content)
    print(json.dumps({'views': 56, 'html': str(args.html.resolve()), 'html_bytes': args.html.stat().st_size,
                      'html_sha256': sha(args.html.read_bytes()), 'markdown': str(args.markdown.resolve()),
                      'published_source_figures_embedded': False}))


if __name__ == '__main__':
    main()
