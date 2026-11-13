#!/usr/bin/env python3
"""Build the complete v58 artwork audit from the accepted, hash-checked manifest.

Uses only Python's standard library. Published reference figures are linked, never
embedded. The only embedded pictures are the project's own v54/v58 WebP artwork.
A pending or incomplete manifest is rejected before either output is written.

Example:
  python3 scripts/build-reference-audit-report-v58.py \
    --html /absolute/output/Heart-Explorer-TTE-TEE-QC.html
"""
import argparse
import base64
from collections import Counter
import hashlib
import html
import json
import os
from pathlib import Path
import re
import tempfile
from urllib.parse import urlsplit


ROOT = Path(__file__).resolve().parents[1]
REVIEW_DATE = 'November 12, 2026'
REVIEW_ZONE = 'America/Chicago'
CLARITY_VIEWS = {'tte:a4c_rv', 'tee:tgrvinout'}
CHECKS = ('topology', 'view_identity', 'orientation', 'labels', 'phase', 'readability')
SCOPE = ('Source-based AI visual QC of educational schematics. '
         'No independent clinician sign-off has been obtained or is implied.')


def require(condition, message):
    if not condition:
        raise ValueError(message)


def sha(data):
    return hashlib.sha256(data).hexdigest()


def key(entry):
    return entry['mode'] + ':' + entry['id']


def title(value):
    return str(value).replace('_', ' ').strip().capitalize()


def esc(value):
    return html.escape(str(value), quote=True)


def public_url(value):
    try:
        parsed = urlsplit(str(value))
        return parsed.scheme in ('https', 'http') and bool(parsed.netloc)
    except ValueError:
        return False


def inline_markdown(text):
    """Small escaped inline renderer for this repository's known Markdown."""
    pieces, offset = [], 0
    pattern = r'(`[^`\n]+`|\[[^\]\n]+\]\([^\s)]+\)|\*\*[^*\n]+\*\*|\*[^*\n]+\*)'
    for match in re.finditer(pattern, text):
        pieces.append(esc(text[offset:match.start()]))
        token = match.group()
        if token.startswith('`'):
            pieces.append('<code>' + esc(token[1:-1]) + '</code>')
        elif token.startswith('['):
            link = re.fullmatch(r'\[([^\]]+)\]\(([^)]+)\)', token)
            label, url = link.groups()
            if public_url(url):
                pieces.append('<a href="' + esc(url) + '" target="_blank" rel="noopener noreferrer">'
                              + esc(label) + '</a>')
            else:
                pieces.append(esc(label) + ' <code>' + esc(url) + '</code>')
        elif token.startswith('**'):
            pieces.append('<strong>' + esc(token[2:-2]) + '</strong>')
        else:
            pieces.append('<em>' + esc(token[1:-1]) + '</em>')
        offset = match.end()
    pieces.append(esc(text[offset:]))
    return ''.join(pieces)


def markdown_html(text):
    """Render headings, paragraphs, lists, tables, quotes and fenced code safely.

    Raw HTML is escaped. Heading levels are shifted down for the report's
    guidelines section. This intentionally has no network or package dependency.
    """
    lines, out, index = text.splitlines(), [], 0

    def separator(line):
        cells = line.strip().strip('|').split('|')
        return bool(cells) and all(re.fullmatch(r'\s*:?-{3,}:?\s*', cell) for cell in cells)

    def cells(line):
        return [inline_markdown(part.strip()) for part in line.strip().strip('|').split('|')]

    def starts_block(i):
        if i >= len(lines):
            return True
        value = lines[i]
        return (not value.strip() or bool(re.match(r'^(#{1,6}\s|```|\s*[-*+]\s|\s*\d+[.)]\s|>\s)', value))
                or (i + 1 < len(lines) and '|' in value and separator(lines[i + 1])))

    while index < len(lines):
        line = lines[index]
        if not line.strip():
            index += 1
            continue
        if line.startswith('```'):
            block = []
            index += 1
            while index < len(lines) and not lines[index].startswith('```'):
                block.append(lines[index])
                index += 1
            out.append('<pre><code>' + esc('\n'.join(block)) + '</code></pre>')
            index += 1
            continue
        heading = re.match(r'^(#{1,6})\s+(.+)$', line)
        if heading:
            level = min(len(heading[1]) + 2, 6)
            out.append(f'<h{level}>' + inline_markdown(heading[2]) + f'</h{level}>')
            index += 1
            continue
        if index + 1 < len(lines) and '|' in line and separator(lines[index + 1]):
            headers = cells(line)
            out.append('<div class="table-scroll"><table><thead><tr>'
                       + ''.join('<th scope="col">' + c + '</th>' for c in headers)
                       + '</tr></thead><tbody>')
            index += 2
            while index < len(lines) and lines[index].strip().startswith('|'):
                out.append('<tr>' + ''.join('<td>' + c + '</td>' for c in cells(lines[index])) + '</tr>')
                index += 1
            out.append('</tbody></table></div>')
            continue
        item = re.match(r'^\s*([-*+]|\d+[.)])\s+(.+)', line)
        if item:
            ordered = bool(re.match(r'\d', item[1]))
            tag = 'ol' if ordered else 'ul'
            out.append('<' + tag + '>')
            while index < len(lines):
                item = re.match(r'^\s*([-*+]|\d+[.)])\s+(.+)', lines[index])
                if not item or bool(re.match(r'\d', item[1])) != ordered:
                    break
                paragraph = [item[2]]
                index += 1
                while index < len(lines) and lines[index].strip() and not starts_block(index):
                    paragraph.append(lines[index].strip())
                    index += 1
                out.append('<li>' + inline_markdown(' '.join(paragraph)) + '</li>')
            out.append('</' + tag + '>')
            continue
        if line.startswith('> '):
            block = []
            while index < len(lines) and lines[index].startswith('> '):
                block.append(lines[index][2:])
                index += 1
            out.append('<blockquote>' + inline_markdown(' '.join(block)) + '</blockquote>')
            continue
        paragraph = [line.strip()]
        index += 1
        while index < len(lines) and not starts_block(index):
            paragraph.append(lines[index].strip())
            index += 1
        out.append('<p>' + inline_markdown(' '.join(paragraph)) + '</p>')
    return '\n'.join(out)


def html_value(value, field=''):
    """Readable recursive records, preserving nested review evidence and prompts."""
    if isinstance(value, dict):
        if not value:
            return '<p class="muted">None recorded.</p>'
        return '<dl class="record">' + ''.join(
            '<div><dt>' + esc(title(name)) + '</dt><dd>' + html_value(item, name) + '</dd></div>'
            for name, item in value.items()) + '</dl>'
    if isinstance(value, list):
        if not value:
            return '<p class="muted">None recorded.</p>'
        return '<ul class="record-list">' + ''.join('<li>' + html_value(item, field) + '</li>' for item in value) + '</ul>'
    if value is None:
        return '<span class="muted">Not specified</span>'
    if isinstance(value, bool):
        return '<span>' + ('Yes' if value else 'No') + '</span>'
    text = str(value)
    if 'prompt' in field:
        return '<pre class="prompt">' + esc(text) + '</pre>'
    if public_url(text):
        return '<a href="' + esc(text) + '" target="_blank" rel="noopener noreferrer">' + esc(text) + '</a>'
    if 'sha256' in field or field.endswith('asset') or field.endswith('path'):
        return '<code class="breakable">' + esc(text) + '</code>'
    return '<p>' + esc(text).replace('\n', '<br>') + '</p>'


def md_value(value, indent=0, field=''):
    prefix = ' ' * indent
    if isinstance(value, dict):
        lines = []
        for name, item in value.items():
            lines.append(prefix + '- **' + title(name) + ':**')
            lines.append('')
            lines.append(md_value(item, indent + 2, name))
            lines.append('')
        return '\n'.join(lines).rstrip() or prefix + 'None recorded.'
    if isinstance(value, list):
        if not value:
            return prefix + 'None recorded.'
        lines = []
        for item in value:
            rendered = md_value(item, indent + 2, field)
            if isinstance(item, (dict, list)):
                lines.append(prefix + '- Record\n\n' + rendered)
            else:
                parts = rendered.splitlines()
                lines.append(prefix + '- ' + parts[0].lstrip() + ('\n' + '\n'.join(parts[1:]) if len(parts) > 1 else ''))
        return '\n\n'.join(lines)
    if value is None:
        return prefix + 'Not specified.'
    if isinstance(value, bool):
        return prefix + ('Yes' if value else 'No')
    text = str(value)
    if 'prompt' in field:
        fence = '`' * max(3, max((len(m.group()) + 1 for m in re.finditer(r'`+', text)), default=3))
        return '\n'.join(prefix + line for line in [fence + 'text', *text.splitlines(), fence])
    if public_url(text):
        text = '<' + text + '>'
    elif 'sha256' in field or field.endswith('asset') or field.endswith('path'):
        text = '`' + text + '`'
    return '\n'.join(prefix + line for line in text.splitlines())


def read_inputs(root):
    manifest_path = root / 'docs/reference-views-v58/asset-manifest.json'
    manifest_bytes = manifest_path.read_bytes()
    manifest = json.loads(manifest_bytes)
    require(manifest.get('review_state') == 'complete', 'The v58 manifest is pending; no report outputs were written.')
    entries = manifest.get('entries', [])
    require(manifest.get('count') == len(entries) == len({key(e) for e in entries}) == 56,
            'The report requires exactly 56 unique accepted records.')
    require(Counter(e['mode'] for e in entries) == {'tte': 28, 'tee': 28}, 'Expected 28 TTE and 28 TEE records.')
    historical_path = root / 'docs/reference-views-v54/asset-manifest.json'
    historical_bytes = historical_path.read_bytes()
    history = {key(e): e for e in json.loads(historical_bytes)['entries']}
    require(set(history) == {key(e) for e in entries}, 'Current and historical catalogue identities differ.')
    images = {}
    for entry in entries:
        identity = key(entry)
        require(entry.get('disposition') in ('retain', 'replace'), identity + ': unfinished disposition')
        review = entry.get('review', {})
        require(review.get('status') == 'pass' and not review.get('hard_failures'), identity + ': unresolved review')
        require(all(review.get('checks', {}).get(check) is True for check in CHECKS), identity + ': incomplete review gates')
        require(review.get('full_size_reviewed') is True and review.get('thumbnail_reviewed') is True,
                identity + ': incomplete visual inspection')
        require(all(review.get(field) for field in ('summary', 'phase', 'independent_review', 'sources', 'original_findings')),
                identity + ': missing per-view evidence')
        for role in ('image', 'thumbnail', 'previous_image', 'previous_thumbnail'):
            meta = entry[role]
            old_role = role.removeprefix('previous_')
            if role.startswith('previous_'):
                require(meta == history[identity][old_role], identity + ': original asset identity changed')
            revision = 54 if role.startswith('previous_') or entry['disposition'] == 'retain' else 58
            expected = (f'public/assets/reference-views-v{revision}/'
                        f'{"thumbs/" if old_role == "thumbnail" else ""}{entry["mode"]}-{entry["id"]}.webp')
            require(meta.get('path') == expected, identity + ': only the matching project artwork may be embedded')
            path = root / expected
            require(path.is_file() and not path.is_symlink(), identity + ': missing regular project artwork')
            data = images.get(expected)
            if data is None:
                data = path.read_bytes()
                images[expected] = data
            require(len(data) == meta['bytes'] and sha(data) == meta['sha256'], identity + ': asset byte/hash mismatch')
        if entry['disposition'] == 'replace':
            require(entry.get('generation', {}).get('prompt'), identity + ': final exact prompt is missing')
            require(entry['image']['sha256'] != entry['previous_image']['sha256'], identity + ': unchanged replacement')
        else:
            require(entry['image'] == entry['previous_image'] and entry['thumbnail'] == entry['previous_thumbnail'],
                    identity + ': retained bytes differ from the original')
    guidelines_bytes = (root / 'docs/reference-views-v58/GUIDELINES.md').read_bytes()
    return manifest, history, images, guidelines_bytes.decode('utf-8'), {
        'manifest_sha256': sha(manifest_bytes),
        'historical_manifest_sha256': sha(historical_bytes),
        'guidelines_sha256': sha(guidelines_bytes),
    }


def classification(entry):
    if entry['disposition'] == 'retain':
        return 'Retained'
    return 'Clarity improvement' if key(entry) in CLARITY_VIEWS else 'Anatomical correction'


def source_record(entry):
    return {'catalogue_table': entry['table'], 'catalogue_view': entry['view_number'],
            'catalogue_source': entry['source'], 'sources_used_in_this_review': entry['review']['sources']}


def review_sections(entry):
    review = entry['review']
    sections = [
        ('Original artwork assessment', review['original_findings'], False),
        ('Final assessment', review['summary'], False),
        ('Phase and limits', {'phase': review['phase'],
                             'limits': review.get('limits', review.get('limits_and_nonfailures', []))}, False),
        ('Source and exact view', source_record(entry), True),
        ('Review scope and evidence', {name: review[name] for name in (
            'independent_review', 'full_size_reviewed', 'thumbnail_reviewed', 'visual_review', 'inspection',
            'approved_final_review', 'gate_evidence', 'gate_findings', 'hard_failures') if name in review}, True),
        ('Preservation and correction constraints', review.get('correction_constraints', []), True),
    ]
    for name, label in [('resolved_suspicions', 'Reconsidered concerns'), ('minor_notes', 'Additional notes'),
                        ('resolved_concerns', 'Reconsidered concerns'),
                        ('rejected_attempts', 'Rejected candidate history')]:
        if review.get(name):
            sections.append((label, review[name], name == 'rejected_attempts'))
    known = {'status', 'checks', 'summary', 'phase', 'limits', 'limits_and_nonfailures', 'original_findings', 'sources',
             'independent_review', 'full_size_reviewed', 'thumbnail_reviewed', 'visual_review', 'inspection',
             'approved_final_review', 'gate_evidence', 'gate_findings', 'hard_failures', 'correction_constraints',
             'resolved_suspicions', 'resolved_concerns', 'minor_notes', 'rejected_attempts'}
    extra = {name: value for name, value in review.items() if name not in known}
    if extra:
        sections.append(('Additional review metadata', extra, True))
    return sections


def generations(entry, old):
    results = []
    if entry['disposition'] == 'replace':
        current = dict(entry['generation'])
        earlier = list(current.pop('prompt_history', []))
        if earlier and earlier[-1] == current['prompt']:
            earlier.pop()
        if earlier:
            current['earlier_prompts_in_order'] = earlier
        results.append(('Accepted replacement: exact final prompt and preceding prompts', current))
    results.append(('Original artwork: provenance location', {
        'historical_manifest': 'docs/reference-views-v54/asset-manifest.json',
        'historical_master_sha256': old.get('source_png_sha256'),
        'note': 'The immutable historical manifest preserves the original authoring prompts. '
                'This report reproduces the exact prompts for this revision’s seven replacements; '
                'all current QC findings and retained-view decisions are included above.'}))
    return results


def asset_rows(entry, old):
    rows = []
    for role, label in [('previous_image', 'Original illustration'), ('image', 'Current illustration'),
                        ('previous_thumbnail', 'Original thumbnail'), ('thumbnail', 'Current thumbnail')]:
        meta = entry[role]
        rows.append((label, meta['path'], f'{meta["width"]} × {meta["height"]}', f'{meta["bytes"]:,}', meta['sha256']))
    if entry.get('source_png_sha256'):
        rows.append(('Accepted generation master', 'Master PNG hash; no published source image embedded', '—', '—', entry['source_png_sha256']))
    if old.get('source_png_sha256'):
        rows.append(('Historical generation master', 'Original master PNG hash', '—', '—', old['source_png_sha256']))
    return rows


def html_assets(entry, old):
    return ('<div class="table-scroll"><table class="asset-table"><thead><tr>'
            '<th scope="col">Asset</th><th scope="col">Path / identity</th><th scope="col">Pixels</th>'
            '<th scope="col">Bytes</th><th scope="col">SHA-256</th></tr></thead><tbody>'
            + ''.join('<tr>' + ''.join('<td>' + (f'<code>{esc(cell)}</code>' if i in (1, 4) else esc(cell))
                                            + '</td>' for i, cell in enumerate(row)) + '</tr>'
                      for row in asset_rows(entry, old)) + '</tbody></table></div>')


def data_image(meta, images):
    return 'data:image/webp;base64,' + base64.b64encode(images[meta['path']]).decode('ascii')


def html_card(entry, old, images):
    identity, changed = key(entry), entry['disposition'] == 'replace'
    badge = classification(entry)
    thumbnail = '' if changed else ('<img class="summary-thumb" src="' + data_image(entry['thumbnail'], images)
                                    + '" width="384" height="384" loading="lazy" alt="Current retained '
                                    + esc(entry['name']) + ' schematic">')
    search = json.dumps({'name': entry['name'], 'id': identity, 'review': entry['review'],
                         'table': entry['table'], 'view': entry['view_number']}, ensure_ascii=False).lower()
    out = [f'<details class="view-card" id="{esc(entry["mode"] + "-" + entry["id"])}" '
           f'data-mode="{esc(entry["mode"])}" data-changed="{str(changed).lower()}" '
           f'data-search="{esc(search)}"' + (' open' if changed else '') + '>',
           '<summary>' + thumbnail + '<span class="summary-text"><span class="eyebrow">'
           + esc(entry['mode'].upper()) + ' · Table ' + esc(entry['table']) + ' · View ' + esc(entry['view_number'])
           + '</span><span class="view-title">' + esc(entry['name']) + '</span><span class="summary-line">'
           + esc(entry['review']['summary']) + '</span></span><span class="badge '
           + ('changed' if changed else 'retained') + '">' + esc(badge) + '</span></summary>', '<div class="card-content">']
    if changed:
        out.append('<div class="comparison">')
        for role, label in [('previous_image', 'Before · superseded v54 artwork'), ('image', 'After · accepted v58 artwork')]:
            out.append('<figure><div class="figure-label">' + esc(label) + '</div><img src="'
                       + data_image(entry[role], images) + '" width="960" height="960" loading="lazy" alt="'
                       + esc(label + ': ' + entry['name']) + '"><figcaption>'
                       + esc('Original ' if role == 'previous_image' else 'Current ')
                       + 'project illustration. ' + ('Superseded in the runtime catalogue.' if role == 'previous_image'
                                                     else 'Accepted within the review scope and limits below.')
                       + '</figcaption></figure>')
        out.append('</div>')
    else:
        out.append('<p class="image-note">The current thumbnail above is embedded from the retained project asset. '
                   'The full illustration and thumbnail remain byte-for-byte identical to v54.</p>')
    out.append('<div class="gates" aria-label="Completed production review checks">'
               + ''.join('<span>✓ ' + esc(title(check)) + '</span>' for check in CHECKS) + '</div>')
    for label, value, collapsed in review_sections(entry):
        if collapsed:
            out.append('<details class="subsection"><summary>' + esc(label) + '</summary>' + html_value(value) + '</details>')
        else:
            out.append('<section><h4>' + esc(label) + '</h4>' + html_value(value) + '</section>')
    out.append('<details class="subsection"><summary>Exact prompts and authoring history</summary>'
               '<p class="muted">Prompts record instructions sent to the generator. They are not proof that '
               'the generated pixels complied. Historical authoring records are separate from this revision’s visual findings.</p>')
    for label, value in generations(entry, old):
        out.append('<details class="subsection"><summary>' + esc(label) + '</summary>' + html_value(value) + '</details>')
    out.append('</details><details class="subsection"><summary>Asset paths and verified hashes</summary>'
               + html_assets(entry, old) + '</details></div></details>')
    return '\n'.join(out)


CSS = r"""
:root{color-scheme:light;--ink:#252b2b;--muted:#5b6664;--paper:#f4f2ec;--card:#fffdfa;--line:#dcded7;--teal:#24675e;--rose:#a85347}
*{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:0;background:var(--paper);color:var(--ink);font:16px/1.6 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}a{color:#195d56;text-underline-offset:3px;overflow-wrap:anywhere}button,input{font:inherit}button{cursor:pointer}button:focus-visible,input:focus-visible,summary:focus-visible,a:focus-visible{outline:3px solid #358d80;outline-offset:4px}main{max-width:1200px;margin:auto;padding:42px 28px 80px}.eyebrow{text-transform:uppercase;letter-spacing:.12em;font-size:.73rem;font-weight:750;color:var(--teal);display:block}h1{font-size:clamp(2.1rem,5vw,3.8rem);line-height:1.07;letter-spacing:-.045em;margin:16px 0 22px;max-width:860px}h2{font-size:1.8rem;line-height:1.25;margin:0 0 16px;letter-spacing:-.025em}h3{font-size:1.35rem;line-height:1.35}h4{font-size:1.04rem;margin:24px 0 9px}h5,h6{font-size:1rem}p{margin:0 0 12px}.lead{font-size:1.17rem;max-width:900px;color:#3e4d49}.notice{border-left:4px solid var(--teal);padding:13px 18px;background:#e6eeea;max-width:100%;margin:22px 0}.stats{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin:26px 0 18px}.stat{padding:20px;background:var(--card);border:1px solid var(--line);border-radius:12px}.stat strong{font-size:2.2rem;display:block;line-height:1.1;letter-spacing:-.04em}.stat span{color:var(--muted);font-size:.9rem}.overview{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:26px;margin:24px 0}.overview p:last-child{margin-bottom:0}.toolbar{display:flex;gap:16px;flex-wrap:wrap;justify-content:space-between;align-items:center;padding:18px 0;position:sticky;top:0;background:rgba(244,242,236,.97);z-index:3;border-bottom:1px solid var(--line);margin-bottom:20px}.filters{display:flex;flex-wrap:wrap;gap:7px}.filters button,.expand-button{background:var(--card);border:1px solid #c7cec6;border-radius:22px;padding:8px 16px;color:var(--ink)}.filters button[aria-pressed=true]{color:white;background:var(--teal);border-color:var(--teal)}.search{display:flex;flex:1 1 260px;max-width:410px;align-items:center;gap:10px}.search label{font-size:.85rem;font-weight:650}.search input{width:100%;min-width:0;padding:10px 13px;border:1px solid #c7cec6;border-radius:9px;background:#fff}.result-line{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px;color:var(--muted);font-size:.9rem;margin:0 0 22px}.expand-button{font-size:.85rem;padding:5px 13px}.view-card{margin:0 0 20px;background:var(--card);border:1px solid var(--line);border-radius:14px;overflow:hidden}.view-card[open]{box-shadow:0 4px 18px #233b3008}.view-card>summary{display:flex;align-items:center;gap:20px;padding:23px;list-style:none;cursor:pointer}.view-card>summary::-webkit-details-marker{display:none}.view-card>summary::after{content:'+';font-size:1.7rem;color:var(--teal);margin-left:auto}.view-card[open]>summary::after{content:'−'}.summary-text{min-width:0;flex:1}.view-title{display:block;font-weight:720;font-size:1.23rem;line-height:1.32;margin:5px 0 9px;letter-spacing:-.02em}.summary-line{display:block;color:var(--muted);font-size:.9rem;line-height:1.5}.summary-thumb{width:110px;height:110px;border-radius:8px;object-fit:contain;border:1px solid #e7e4dc;flex:none}.badge{font-size:.73rem;line-height:1.35;font-weight:700;padding:7px 10px;border-radius:8px;white-space:normal;max-width:130px}.badge.changed{color:#8a3f34;background:#f6e4dd}.badge.retained{color:#29634d;background:#e7efe7}.card-content{padding:0 26px 27px;border-top:1px solid var(--line)}.comparison{display:grid;grid-template-columns:1fr 1fr;gap:20px;margin:25px 0}figure{margin:0;min-width:0}.comparison img{width:100%;height:auto;display:block;border:1px solid #e2ded5;border-radius:10px;background:#f6f3ee}.figure-label{text-transform:uppercase;letter-spacing:.07em;font-size:.74rem;font-weight:750;margin-bottom:9px;color:#52635b}figcaption,.image-note{font-size:.83rem;color:var(--muted);margin:10px 0 0}.image-note{margin-top:20px}.gates{display:flex;gap:6px;flex-wrap:wrap;padding:18px 0 8px}.gates span{background:#edf2ec;color:#42644d;border-radius:5px;padding:4px 9px;font-size:.74rem;font-weight:650}.record{margin:10px 0}.record>div{margin:0 0 12px}.record dt{font-weight:650;font-size:.84rem;color:#59635f}.record dd{margin:2px 0 0;padding-left:13px;border-left:2px solid #e6e9e2}.record p:last-child{margin-bottom:0}.record-list{padding-left:22px;margin:8px 0 16px}.record-list>li{padding-left:3px;margin-bottom:10px}.record-list p{margin-bottom:4px}.subsection{border:1px solid #e1e4dc;border-radius:8px;margin:13px 0;background:#fcfcf8;padding:0 15px}.subsection>summary{cursor:pointer;font-size:.92rem;font-weight:680;padding:13px 0}.subsection[open]{padding-bottom:12px}.subsection .subsection{background:#fffefa}pre{white-space:pre-wrap;overflow-wrap:anywhere;word-break:break-word;background:#eef0e9;padding:17px;border-radius:8px;font:13px/1.6 ui-monospace,SFMono-Regular,Consolas,monospace;max-width:100%;margin:12px 0}code{font: .82em/1.55 ui-monospace,SFMono-Regular,Consolas,monospace;overflow-wrap:anywhere;word-break:break-word}p code,li code{background:#eef0e9;padding:2px 4px;border-radius:3px}.muted{color:var(--muted)}.table-scroll{max-width:100%;overflow-x:auto;margin:15px 0}table{border-collapse:collapse;width:100%;font-size:.86rem;text-align:left;table-layout:auto}th,td{vertical-align:top;padding:12px 11px;border-bottom:1px solid #dce1d7;overflow-wrap:anywhere}th{font-weight:700;background:#eef1e9}td{background:#fffefa}.asset-table{table-layout:fixed}.asset-table th:nth-child(1){width:16%}.asset-table th:nth-child(2){width:28%}.asset-table th:nth-child(3){width:12%}.asset-table th:nth-child(4){width:11%}.asset-table th:nth-child(5){width:33%}.guidelines{margin-top:45px;padding:28px;background:#fffdfa;border:1px solid var(--line);border-radius:14px}.guidelines-content{max-width:100%;overflow-wrap:anywhere}.guidelines h3{margin-top:32px}.guidelines h4{margin-top:28px}.guidelines li{margin-bottom:9px}.guidelines table{font-size:.9rem}.guidelines th:first-child{width:27%}blockquote{border-left:3px solid var(--teal);padding-left:20px;margin-left:0;color:var(--muted)}footer{border-top:1px solid var(--line);margin-top:35px;padding-top:24px;color:var(--muted);font-size:.82rem}.manifest-hashes{display:grid;grid-template-columns:minmax(140px,1fr) minmax(0,3fr);gap:6px 18px;margin-top:18px}.manifest-hashes dt{font-weight:650}.manifest-hashes dd{margin:0}.empty{padding:30px;background:#fffdfa;border:1px dashed var(--line);text-align:center;border-radius:12px}[hidden]{display:none!important}.quick-links{display:flex;gap:20px;flex-wrap:wrap;margin-top:18px;font-size:.9rem}.noscript{padding:12px;background:#fff2c5}.small{font-size:.86rem}
@media(max-width:760px){main{padding:25px 16px 50px}.stats{grid-template-columns:1fr 1fr}.stat{padding:16px}.toolbar{position:static;gap:12px}.search{max-width:none;flex-basis:100%}.overview,.guidelines{padding:20px}.view-card>summary{padding:17px;gap:12px;flex-wrap:wrap}.summary-thumb{width:78px;height:78px}.summary-text{flex-basis:calc(100% - 105px)}.badge{margin-left:90px;max-width:none}.view-card[data-changed=true] .badge{margin-left:0}.view-card[data-changed=true] .summary-text{flex-basis:100%}.card-content{padding:0 17px 20px}.comparison{gap:12px}.figure-label{font-size:.65rem}.manifest-hashes{grid-template-columns:1fr}.manifest-hashes dd{margin-bottom:12px}.asset-table{min-width:620px}}
@media(max-width:480px){.comparison{grid-template-columns:1fr}.stat strong{font-size:1.9rem}.summary-line{font-size:.85rem}.view-title{font-size:1.07rem}.filters button{padding:7px 12px}.record dd{padding-left:9px}}
@media print{body{background:white;font-size:11px}main{max-width:none;padding:0}.toolbar,.expand-button,.quick-links{display:none}.view-card,.overview,.guidelines{box-shadow:none;break-inside:auto}.comparison{break-inside:avoid}.stats{grid-template-columns:repeat(4,1fr)}.view-card>summary{break-after:avoid}.summary-thumb{width:70px;height:70px}a{color:inherit}.subsection{border-color:#ddd}.asset-table{min-width:0}.table-scroll{overflow:visible}}
"""


JAVASCRIPT = r"""
(() => {
  const cards = [...document.querySelectorAll('.view-card')];
  const buttons = [...document.querySelectorAll('[data-filter]')];
  const search = document.getElementById('view-search');
  const count = document.getElementById('result-count');
  let filter = 'all';
  const apply = () => {
    const words = search.value.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
    let visible = 0;
    for (const card of cards) {
      const modeMatch = filter === 'all' || (filter === 'changed' ? card.dataset.changed === 'true' : card.dataset.mode === filter);
      const textMatch = words.every(word => card.dataset.search.includes(word));
      card.hidden = !(modeMatch && textMatch);
      if (!card.hidden) visible++;
    }
    count.textContent = `${visible} of ${cards.length} views shown`;
    document.getElementById('empty-state').hidden = visible !== 0;
  };
  buttons.forEach(button => button.addEventListener('click', () => {
    filter = button.dataset.filter;
    buttons.forEach(item => item.setAttribute('aria-pressed', String(item === button)));
    apply();
  }));
  search.addEventListener('input', apply);
  document.getElementById('expand-visible').addEventListener('click', () => cards.filter(c => !c.hidden).forEach(c => c.open = true));
  document.getElementById('collapse-visible').addEventListener('click', () => cards.filter(c => !c.hidden).forEach(c => c.open = false));
  let printState = [];
  addEventListener('beforeprint', () => {
    printState = [...document.querySelectorAll('details')].map(node => [node, node.open]);
    printState.forEach(([node]) => node.open = true);
  });
  addEventListener('afterprint', () => printState.forEach(([node, open]) => node.open = open));
  apply();
})();
"""


def build_html(manifest, history, images, guidelines, hashes):
    entries = manifest['entries']
    counts = Counter(e['disposition'] for e in entries)
    types = Counter(classification(e) for e in entries)
    ordered = sorted(entries, key=lambda e: (e['disposition'] != 'replace', e['mode'] != 'tte', entries.index(e)))
    mode_summary = ', '.join(f'{sum(e["mode"] == mode for e in entries)} {mode.upper()}' for mode in ('tte', 'tee'))
    stats = [('56', 'individual illustrations reviewed'), (str(counts['retain']), 'retained with documented limits'),
             (str(types['Anatomical correction']), 'anatomical corrections'), (str(types['Clarity improvement']), 'clarity improvements')]
    sections = [
        '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">',
        '<meta name="description" content="Complete source-based visual QC of 56 Heart Explorer TTE and TEE educational illustrations, with per-view evidence and before/after artwork.">',
        '<title>Heart Explorer · TTE &amp; TEE Illustration QC</title><style>' + CSS + '</style></head><body><main>',
        '<header><span class="eyebrow">Heart Explorer · Reference artwork · Revision 58</span><h1>TTE &amp; TEE<br>illustration quality review</h1>',
        '<p class="lead">A complete, per-view review of ' + esc(mode_summary) + ' schematics, with source comparisons, '
        'recorded limits and exact before/after artwork for every replacement.</p>',
        '<p class="small muted">' + REVIEW_DATE + ' · ' + REVIEW_ZONE + ' · Production artwork audit</p>',
        '<div class="notice"><strong>Review scope.</strong> ' + esc(SCOPE) + ' Passing these checks means no unresolved '
        'failure was identified within the recorded review; it is not clinical validation or a guarantee of diagnostic fidelity.</div>',
        '<div class="stats">' + ''.join('<div class="stat"><strong>' + n + '</strong><span>' + label + '</span></div>' for n, label in stats) + '</div>',
        '<p class="muted">' + str(counts['replace']) + ' replacements total. The two clarity changes concern RV-focused apical framing '
        'and transgastric RV outflow depiction. Source-specific qualifications remain attached to each retained view.</p>',
        '<nav class="quick-links" aria-label="Report sections"><a href="#views">Per-view audit</a><a href="#guidelines">Full correction guidelines</a><a href="#integrity">Provenance and integrity</a></nav></header>',
        '<section class="overview"><h2>How to read the review</h2><p>The changed illustrations are expanded first, '
        'with the superseded original beside the accepted replacement. Each remaining illustration has its own expandable '
        'record and current thumbnail. All six production checks, source details, phase assumptions, constraints and '
        'review limitations are preserved for every view.</p><p>Thin coapting valve leaflets and structures leaving a '
        'two-dimensional section are not automatically errors. The review records corrected tentative concerns, including '
        'the coronary-sinus section with the mitral valve outside the plane and the anteriorly angled five-chamber section '
        'without a separately identifiable right atrium. The findings distinguish those cases from unsupported muscular '
        'barriers, obstructing projections and misleading framing.</p><p>Only original Heart Explorer artwork is embedded '
        'in this report. Published anatomy and ultrasound figures are linked as references. Exact generation prompts are '
        'authoring history; the visual review of the resulting pixels establishes the production decision.</p></section>',
        '<section id="views" aria-labelledby="views-title"><h2 id="views-title">Individual illustration records</h2>',
        '<noscript><p class="noscript">All records and images remain available without JavaScript. Search and filters require JavaScript.</p></noscript>',
        '<div class="toolbar"><div class="filters" role="group" aria-label="Filter illustrations">'
        + ''.join('<button type="button" data-filter="' + value + '" aria-pressed="' + str(value == 'all').lower() + '">' + label + '</button>'
                  for value, label in [('all', 'All'), ('changed', 'Changed'), ('tte', 'TTE'), ('tee', 'TEE')])
        + '</div><div class="search"><label for="view-search">Search</label><input id="view-search" type="search" placeholder="View, structure, finding or source…" autocomplete="off"></div></div>',
        '<div class="result-line"><span id="result-count" role="status" aria-live="polite">56 of 56 views shown</span><span><button class="expand-button" id="expand-visible" type="button">Expand visible</button> <button class="expand-button" id="collapse-visible" type="button">Collapse visible</button></span></div>',
        '<p id="empty-state" class="empty" hidden>No views match this filter and search. Clear the search or choose All.</p>',
        *[html_card(entry, history[key(entry)], images) for entry in ordered], '</section>',
        '<section id="guidelines" class="guidelines" aria-labelledby="guidelines-title"><span class="eyebrow">Complete production guidance</span><h2 id="guidelines-title">Anatomical and visual acceptance guidelines</h2><p class="muted">The complete revision 58 guideline is reproduced below. Individual review records take precedence over an unsupported inference from a generic rule.</p><div class="guidelines-content">',
        markdown_html(guidelines), '</div></section>',
        '<footer id="integrity"><h2>Provenance and integrity</h2><p>The report was generated from the completed v58 asset '
        'manifest, the immutable v54 authoring manifest and the full v58 guideline. Every embedded image was checked '
        'against its declared file size and SHA-256. Current and historical hashes are recorded per view; this verifies '
        'file identity, not anatomical accuracy.</p><p>Review date: ' + REVIEW_DATE + ' (' + REVIEW_ZONE + '). Individual '
        'UTC timestamps may show November 13 because the review spans that UTC date. Source figures are not redistributed. '
        'This HTML contains its own styles, controls and project image bytes and does not need a network connection to read.</p>',
        '<dl class="manifest-hashes">' + ''.join('<dt>' + esc(title(label)) + '</dt><dd><code>' + esc(value) + '</code></dd>' for label, value in hashes.items()) + '</dl>',
        '<p>' + esc(SCOPE) + '</p></footer></main><script>' + JAVASCRIPT + '</script></body></html>',
    ]
    return '\n'.join(sections)


def markdown_image_path(meta, markdown_path, root):
    return Path(os.path.relpath(root / meta['path'], markdown_path.parent)).as_posix()


def build_markdown(manifest, history, guidelines, hashes, markdown_path, root):
    entries = manifest['entries']
    counts = Counter(e['disposition'] for e in entries)
    types = Counter(classification(e) for e in entries)
    out = ['# Heart Explorer TTE and TEE illustration audit — revision 58', '',
           f'**Review date:** {REVIEW_DATE} ({REVIEW_ZONE}).', '', '**Scope:** ' + SCOPE, '',
           f'All **{len(entries)} illustrations** have an individual record: '
           f'{sum(e["mode"] == "tte" for e in entries)} TTE and {sum(e["mode"] == "tee" for e in entries)} TEE. '
           f'**{counts["retain"]} retained; {counts["replace"]} replaced.** '
           f'The replacements comprise {types["Anatomical correction"]} anatomical corrections and '
           f'{types["Clarity improvement"]} clarity improvements.', '',
           'The RV-focused TTE and transgastric RV inflow–outflow TEE changes improve framing or outlet clarity. '
           'The report does not diagnose pathology from the old artwork. Thin coapting valves and structures leaving '
           'the imaging plane are not automatically faults. Reconsidered concerns and retained-view limitations '
           'remain explicit in the records.', '',
           'All embedded/referenced artwork is this project’s own work. Published anatomy and ultrasound references '
           'are linked, not reproduced. Exact prompts record instructions to the generator, not evidence that those '
           'instructions were satisfied. The previous manifest’s approval text is historical and does not establish '
           'the outcome of this review.', '',
           '## Decision index', '', '| Modality | View | ASE table / view | Decision |', '| --- | --- | --- | --- |']
    for entry in entries:
        out.append(f'| {entry["mode"].upper()} | {entry["name"]} (`{entry["id"]}`) | '
                   f'{entry["table"]} / {entry["view_number"]} | {classification(entry)} |')
    out += ['', '## Per-view audit', '']
    for entry in entries:
        old = history[key(entry)]
        out += [f'### {entry["mode"].upper()} · {entry["name"]}', '',
                f'**ID:** `{key(entry)}` · **Decision:** {classification(entry)} · '
                f'**ASE table/view:** {entry["table"]} / {entry["view_number"]}', '']
        if entry['disposition'] == 'replace':
            out += ['| Before — superseded v54 artwork | After — accepted v58 artwork |', '| --- | --- |',
                    f'| ![Superseded {entry["name"]}]({markdown_image_path(entry["previous_image"], markdown_path, root)}) '
                    f'| ![Accepted {entry["name"]}]({markdown_image_path(entry["image"], markdown_path, root)}) |', '']
        else:
            out += [f'![Current retained {entry["name"]}]({markdown_image_path(entry["thumbnail"], markdown_path, root)})', '',
                    'The full illustration and thumbnail are retained byte-for-byte from v54.', '']
        out += ['**Production checks:** ' + '; '.join(title(check) + ' — pass' for check in CHECKS) + '.', '']
        for label, value, _ in review_sections(entry):
            out += ['#### ' + label, '', md_value(value), '']
        out += ['<details>', '<summary>Exact prompts and authoring history</summary>', '',
                'Prompts describe requested changes. Historical authoring records do not supersede this review’s findings.', '']
        for label, value in generations(entry, old):
            out += ['##### ' + label, '', md_value(value), '']
        out += ['</details>', '', '#### Asset identity', '',
                '| Asset | Path / identity | Pixels | Bytes | SHA-256 |', '| --- | --- | --- | --- | --- |']
        for row in asset_rows(entry, old):
            out.append('| ' + ' | '.join('`' + str(value) + '`' if i in (1, 4) else str(value)
                                         for i, value in enumerate(row)) + ' |')
        out += ['', '---', '']
    out += ['## Complete acceptance and correction guidelines', '',
            'The following is the complete content of `GUIDELINES.md` for this revision.', '', guidelines.rstrip(), '',
            '## Report integrity', '',
            'All project image bytes used in this report were checked against the completed manifest’s byte counts '
            'and SHA-256 values. File identity verification is separate from the visual anatomy review.', '',
            '| Input | SHA-256 |', '| --- | --- |']
    for label, value in hashes.items():
        out.append('| ' + title(label) + ' | `' + value + '` |')
    out += ['', SCOPE, '']
    return '\n'.join(out)


def atomic_write(path, text):
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(mode='w', encoding='utf-8', dir=path.parent, prefix='.' + path.name + '.',
                                     suffix='.tmp', delete=False) as handle:
        temporary = Path(handle.name)
        try:
            handle.write(text)
            handle.flush()
            os.fsync(handle.fileno())
        except BaseException:
            temporary.unlink(missing_ok=True)
            raise
    os.replace(temporary, path)


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--html', type=Path, required=True, help='Absolute destination for the self-contained HTML report.')
    parser.add_argument('--markdown', type=Path, help='Optional Markdown destination; defaults to docs/reference-views-v58/AUDIT.md.')
    parser.add_argument('--root', type=Path, default=ROOT, help='Project root (defaults to the repository containing this script).')
    args = parser.parse_args()
    try:
        require(args.html.is_absolute(), '--html must name an absolute output path.')
        root = args.root.resolve()
        markdown_path = args.markdown.resolve() if args.markdown else root / 'docs/reference-views-v58/AUDIT.md'
        require(args.html.resolve() != markdown_path.resolve(), 'HTML and Markdown outputs must be different files.')
        protected = {root / f'docs/reference-views-v{revision}/asset-manifest.json' for revision in (54, 58)}
        protected.add(root / 'docs/reference-views-v58/GUIDELINES.md')
        require(args.html.resolve() not in protected and markdown_path.resolve() not in protected,
                'An output must not overwrite a report input.')
        manifest, history, images, guidelines, hashes = read_inputs(root)
        html_document = build_html(manifest, history, images, guidelines, hashes)
        markdown_document = build_markdown(manifest, history, guidelines, hashes, markdown_path, root)
        require(html_document.count('class="view-card"') == 56, 'HTML record count failed.')
        require(markdown_document.count('\n### TTE · ') == 28 and markdown_document.count('\n### TEE · ') == 28,
                'Markdown record count failed.')
        atomic_write(args.html, html_document)
        atomic_write(markdown_path, markdown_document)
        print(json.dumps({'views': 56, 'decisions': dict(Counter(e['disposition'] for e in manifest['entries'])),
                          'categories': dict(Counter(classification(e) for e in manifest['entries'])),
                          'embedded_project_images': html_document.count('src="data:image/webp;base64,'),
                          'html': str(args.html), 'html_bytes': len(html_document.encode()),
                          'markdown': str(markdown_path), 'markdown_bytes': len(markdown_document.encode()),
                          **hashes}, indent=2))
    except (ValueError, KeyError, OSError, json.JSONDecodeError) as error:
        parser.exit(1, f'Cannot build artwork audit: {error}\n')


if __name__ == '__main__':
    main()
