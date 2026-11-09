#!/usr/bin/env python3
"""Offline release-report gates and measured whole-bank sampling joins.

No uploads or original image reads. All mutation cases use private /tmp copies.
The completed pilot remains the only generated report. Whole-bank checks join
already completed record metadata and verify the source-object identity ledger;
they do not claim a finished overview or generate the production README.
"""
from pathlib import Path
import ast
import hashlib
import importlib.util
import json
import shutil
import subprocess
import sys
import tempfile

sys.dont_write_bytecode = True


REPO = Path(__file__).resolve().parents[2]
SCRIPTS = REPO/'scripts/guided-native-v21'
SCRIPT = SCRIPTS/'write_release_report.py'
BASE = Path('{source-cache}/guided-native-v21')
PILOT = BASE/'pilot/run-compiled-hosted'
FINAL = BASE/'manifest-compiler-fixtures/fixture-result'
OVERVIEW = BASE/'overview-hosted-pilot/manifest.json'
PREVIEW = Path('{temporary-cache}')


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    command = [sys.executable,str(SCRIPT),'--run',str(PILOT),
               '--final-manifest',str(FINAL),'--overview',str(OVERVIEW)]
    rows = []
    spec = importlib.util.spec_from_file_location('release_report_checks', SCRIPT)
    generator = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(generator)

    def run(name, argv, success, expected=None):
        result = subprocess.run(argv,cwd=REPO,text=True,capture_output=True)
        assert (result.returncode == 0) == success, (name,result.stdout,result.stderr)
        if expected:
            assert expected in result.stderr, (name,result.stderr)
        value = json.loads(result.stdout) if success else result.stderr.strip()
        if isinstance(value,dict):
            value.pop('output',None)
            value.pop('summary',None)
        rows.append(dict(check=name,passed=True,exitCode=result.returncode,result=value))

    readme = REPO/'docs/guided-native-v21/README.md'
    before = digest(readme) if readme.exists() else None
    live = json.loads((BASE/'whole/run/run.json').read_text())
    live_progress = json.loads((BASE/'whole/run/progress.json').read_text())
    with tempfile.TemporaryDirectory(prefix='release-report-gates-',dir='/tmp') as name:
        temporary = Path(name)
        incomplete = temporary/'incomplete'
        incomplete.mkdir()
        shutil.copyfile(PILOT/'run.json',incomplete/'run.json')
        value = json.loads((PILOT/'progress.json').read_text())
        value['complete'] = False
        (incomplete/'progress.json').write_text(json.dumps(value))
        if live_progress['complete'] is False:
            run('Actual unfinished whole run cannot write a report',
                [sys.executable,str(SCRIPT),'--output',str(temporary/'unfinished.md')],False,'Run is unfinished')
        else:
            run('Incomplete run cannot write a report',
                [*command,'--run',str(incomplete),'--output',str(temporary/'unfinished.md')],False,'Run is unfinished')
        run('Completed alternate small plan cannot be labeled whole-plan',
            [*command,'--output',str(PREVIEW)],False,'independently pinned whole-plan processing run')
        run('Explicit pilot cannot target production README',
            [*command,'--allow-pilot'],False,'separate, explicitly named output under /tmp')
        run('Completed eight-tile pilot with clearly marked receipt fixtures',
            [*command,'--allow-pilot','--output',str(PREVIEW)],True)
        first = digest(PREVIEW)
        run('Identical pilot inputs produce identical report bytes',
            [*command,'--allow-pilot','--output',str(PREVIEW)],True)
        assert digest(PREVIEW) == first
        preview_summary = json.loads(PREVIEW.with_suffix('.json').read_text())
        preview = PREVIEW.read_text()
        sampling = preview_summary['overviewSampling']
        generations = preview_summary['sourceGenerationMetadata']
        assert sampling['nativeIndexEntriesRetained'] == 8
        assert sampling['nativeIndexIncludesEveryNonemptyRecord'] is True
        assert f"{sampling['nonemptyNativeBlocksWithoutOverviewCrossings']:,} nonempty native tiles" in preview
        assert f"metadata is absent for **{generations['generationUnavailableObjects']:,}**" in preview
        assert 'display omission before simplification' in preview
        assert 'not disjoint surface area or anatomical completeness' in preview
        assert preview_summary['wholeFigureProvenance'] is None
        assert 'whole-detail-render' not in preview
        rows.append(dict(check='Pilot report contains computed display omissions, generation availability and crossing-count scope',
            passed=True,overviewSampling=sampling,sourceGenerationMetadata=generations))
        changed = temporary/'overview.json'
        changed.write_bytes(OVERVIEW.read_bytes()+b' ')
        run('Changed overview manifest rejected',
            [*command,'--overview',str(changed),'--allow-pilot','--output',str(PREVIEW)],False,
            'Overview manifest has changed')
        bad_progress = temporary/'bad-progress'
        bad_progress.mkdir()
        shutil.copyfile(PILOT/'run.json',bad_progress/'run.json')
        value = json.loads((PILOT/'progress.json').read_text())
        value['completedCoreBlocks'] -= 1
        (bad_progress/'progress.json').write_text(json.dumps(value))
        run('Inconsistent completed progress rejected',
            [*command,'--run',str(bad_progress),'--allow-pilot','--output',str(PREVIEW)],False,
            'Run/progress completion counts disagree')
        changed_final = temporary/'final'
        shutil.copytree(FINAL,changed_final)
        with (changed_final/'manifest.json.gz').open('ab') as stream:
            stream.write(b'corrupt')
        run('Corrupt content-addressed gzip rejected',
            [*command,'--final-manifest',str(changed_final),'--allow-pilot','--output',str(PREVIEW)],False,
            'Compressed checksum/size mismatch')

    # The display join must never become a filter on the native tile index.
    native = [dict(xyz=[1,2,3],triangles=7),dict(xyz=[2,2,3],triangles=11)]
    inputs = [dict(coordinatesXYZ=[1,2,3],triangles=0),
              dict(coordinatesXYZ=[2,2,3],triangles=2),
              dict(coordinatesXYZ=[3,2,3],triangles=0)]
    expected = {(1,2,3),(2,2,3)}
    value = generator.overview_sampling_summary(native,inputs,expected)
    assert value['nonemptyNativeBlocksWithoutOverviewCrossings'] == 1
    assert value['nativeTrianglesInThoseBlocks'] == 7 and value['nativeIndexEntriesRetained'] == 2
    rows.append(dict(check='A zero-display tile remains in the complete native index',passed=True,result=value))
    for name,tiles,overview,status in (
        ('Missing nonempty native index entry rejected',native[1:],inputs,expected),
        ('Duplicate overview coordinate rejected',native,inputs+[inputs[0]],expected),
        ('Nonempty display attributed to an empty native field rejected',native,
            inputs[:-1]+[dict(coordinatesXYZ=[3,2,3],triangles=1)],expected)):
        try:
            generator.overview_sampling_summary(tiles,overview,status)
        except generator.ReportError as error:
            rows.append(dict(check=name,passed=True,result=str(error)))
        else:
            raise AssertionError(name)

    # Actual completed whole-bank metadata, not synthetic final-display receipts.
    whole = BASE/'whole/run'
    overview_inputs = json.loads((BASE/'whole/overview/input-manifest.json').read_text())
    audit = json.loads((REPO/'docs/guided-native-v21/completed-bank-audit.json').read_text())
    assert audit['passed'] is True and audit['scope'] == 'whole-plan'
    assert overview_inputs['runFingerprint'] == audit['processingFingerprint'] == live['fingerprint']
    assert overview_inputs['runManifestSha256'] == digest(whole/'run.json')
    whole_tiles, whole_nonempty = [], set()
    for item in overview_inputs['records']:
        path = whole/'records'/('_'.join(map(str,item['coordinatesXYZ']))+'.json')
        raw = path.read_bytes()
        record = json.loads(raw)
        assert hashlib.sha256(raw).hexdigest() == item['recordSha256']
        assert record['coordinatesXYZ'] == item['coordinatesXYZ']
        if not record['empty']:
            whole_nonempty.add(tuple(record['coordinatesXYZ']))
            whole_tiles.append(dict(xyz=record['coordinatesXYZ'],triangles=record['nativeTriangles']))
    measured = generator.overview_sampling_summary(whole_tiles,overview_inputs['records'],whole_nonempty)
    assert measured['nonemptyNativeBlocksWithoutOverviewCrossings'] == audit['overviewNativeNonemptyButStep4EmptyTiles']
    assert measured['nativeIndexEntriesRetained'] == audit['totals']['nonemptyNativeTiles']
    rows.append(dict(check='Actual whole-bank display omission join matches the independent completed-bank audit',
        passed=True,result=measured))
    original = audit['source']
    source = dict(uniqueObjectsRead=original['uniqueObjects'],uniqueObjectEncodedBytes=original['uniqueObjectEncodedBytes'],
        deduplicatedObjectsCanonicalSha256=original['deduplicatedObjectsCanonicalSha256'])
    measured = generator.source_generation_summary(whole/'source-objects.jsonl',original['logSha256'],source)
    assert measured['generationUnavailableObjects'] == original['generationUnavailableUniqueObjects']
    assert measured['generationUnavailableObjectsObservedOnlyFromCache'] == measured['generationUnavailableObjects']
    rows.append(dict(check='Actual whole source-generation metadata reproduces the finalized canonical identity hash',
        passed=True,result=measured))

    whole_overview_path = BASE/'whole/overview/manifest.json'
    whole_overview = json.loads(whole_overview_path.read_text())
    figure, provenance = generator.verify_whole_figure(whole_overview,digest(whole_overview_path),overview_inputs)
    assert figure.is_file() and provenance['lod'] == 'detail' and provenance['triangles'] == 2500000
    rows.append(dict(check='Actual whole-detail figure matches the completed manifest, source identity, LOD parts and PNG hashes',
        passed=True,result=provenance))
    figure_record = json.loads((REPO/'docs/guided-native-v21/whole-detail-render/render-record.json').read_text())
    with tempfile.TemporaryDirectory(prefix='whole-render-report-gates-',dir='/tmp') as name:
        for label, changed in (
            ('Foreign whole-render manifest rejected',dict(figure_record,manifestSha256='0'*64)),
            ('Wrong whole-render LOD rejected',dict(figure_record,lod='overview')),
            ('Different rendered HFM part rejected',dict(figure_record,parts=[dict(figure_record['parts'][0],sha256='0'*64)]))):
            path = Path(name)/'render-record.json'
            path.write_text(json.dumps(changed))
            try:
                generator.verify_whole_figure(whole_overview,digest(whole_overview_path),overview_inputs,path)
            except generator.ReportError as error:
                rows.append(dict(check=label,passed=True,result=str(error)))
            else:
                raise AssertionError(label)

    # Compare each tool's independent pins with the actual selected plan, without
    # treating a match as evidence that the live reconstruction has completed.
    for script in (SCRIPT,SCRIPTS/'finalize_manifest.py'):
        tree = ast.parse(script.read_text())
        constants = {target.id:ast.literal_eval(node.value)
            for node in tree.body if isinstance(node,ast.Assign)
            for target in node.targets if isinstance(target,ast.Name)
            and target.id in ('WHOLE_PLAN_SHA256','WHOLE_RUN_FINGERPRINT')}
        assert constants['WHOLE_RUN_FINGERPRINT'] == live['fingerprint']
        assert all(digest(Path(live[key])) == constants['WHOLE_PLAN_SHA256'] for key in ('inputPlan','corePlan'))
    rows.append(dict(check='Both independent whole-scope pins match the actual selected plan and run',passed=True))
    assert (digest(readme) if readme.exists() else None) == before
    report = dict(schema='guided-native-release-report-verification-v21.1',allChecksPassed=True,
        scope='Pilot report with explicit local fixtures; whole-scope refusal gates; direct metadata joins of the completed whole native bank, without claiming a completed display overview',
        wholeReadmeWritten=False,wholeReadmeUnchanged=True,wholeCompletionNotAsserted=True,
        networkRequests=0,uploads=0,generatorSha256=digest(SCRIPT),
        pilotMarkdownSha256=first,pilotMarkdownWordCount=len(PREVIEW.read_text().split()),checks=rows)
    (Path(__file__).with_name('release-report-verification.json')).write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps(dict(allChecksPassed=True,checks=len(rows),pilotMarkdownWordCount=report['pilotMarkdownWordCount'],
        wholeReadmeUnchanged=True,generatorSha256=report['generatorSha256'])))


if __name__ == '__main__':
    main()
