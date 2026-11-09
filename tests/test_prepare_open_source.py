"""Public-export safety and actual runtime availability behavior (stdlib + Node)."""
import importlib.util
import json
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location('heart_public_export', ROOT/'scripts/prepare-open-source.py')
EXPORT = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(EXPORT)


class PublicExportTests(unittest.TestCase):
    def test_git_inventory_keeps_dotfiles_rejects_symlinks_and_omits_secrets(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            subprocess.run(['git','init','-q',str(root)],check=True)
            for name in ('.npmrc', '.env', '.env.local', '.dev.vars', 'key.pem', 'app.js', 'data/cache.bin', 'node_modules/example.js'):
                path = root/name
                path.parent.mkdir(parents=True,exist_ok=True)
                path.write_text('example')
            subprocess.run(['git','-C',str(root),'add','--all'],check=True)
            self.assertEqual(list(EXPORT.source_files(root)), ['.npmrc','app.js'])
            (root/'linked.js').symlink_to(root/'app.js')
            with self.assertRaisesRegex(ValueError,'symlink'):
                list(EXPORT.source_files(root))

    def test_sanitization_keeps_scientific_policy_and_removes_private_locations(self):
        original = json.dumps({'boxCollarSamples':8, 'threshold':17133.4,
                               'path':'/workspace/scratch/abcd/native/mesh.hfm',
                               'source':'https://human-organ-atlas.esrf.fr/datasets/1659197537',
                               'transfer':'https://institution.app.box.com/s/private/file/123',
                               'home':'/root/project/review.py'})
        clean = EXPORT.sanitize_document(original)
        data = json.loads(clean)
        self.assertEqual(data['boxCollarSamples'],8)
        self.assertEqual(data['threshold'],17133.4)
        self.assertEqual(data['source'],json.loads(original)['source'])
        self.assertNotIn('box.com',clean)
        self.assertNotIn('/workspace/',clean)
        self.assertNotIn('/root/',clean)
        self.assertIsNone(EXPORT.document_omission('docs/cleanup-v30/atrial-policy.json'))
        self.assertIsNone(EXPORT.document_omission('docs/guided-native-v21/INTENSITY-RECOVERY-REVIEW.md'))
        self.assertIsNone(EXPORT.document_omission('docs/probe-heart-v44/whole-heart-model-review.jpg'))
        self.assertIsNotNone(EXPORT.document_omission('docs/tee-atlas/review.jpg'))
        self.assertIsNotNone(EXPORT.document_omission('docs/run/box-checkpoint.json'))
        self.assertIsNotNone(EXPORT.document_omission('AGENTS.md'))

    def test_unreviewed_payloads_fail_closed_and_metadata_is_not_relicensed_as_hoa(self):
        families = {'hoa':{'id':'hoa','license':'CC-BY-4.0','decision':'include-under-upstream-license'}}
        with self.assertRaisesRegex(ValueError,'Unreviewed'):
            EXPORT.reviewed_asset('public/assets/new-third-party/model.gz',families,{})
        item = EXPORT.reviewed_asset('public/assets/probe-heart-v44/s-20-28.hfm.gz',families,{})
        self.assertEqual((item['family'],item['sourceId'],item['license']),('hoa','s-20-28','CC-BY-4.0'))
        item = EXPORT.reviewed_asset('public/assets/echo-media-v6.json',families,{})
        self.assertEqual(item['family'],'echo-media-metadata')

    def test_restored_payloads_are_ignored_without_hiding_metadata_or_readme_image(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            subprocess.run(['git','init','-q',str(root)],check=True)
            (root/'.gitignore').write_text('.env\n')
            payloads = ['public/assets/probe-heart-v44/s-20-28.hfm.gz',
                        'public/assets/echo-media-v7/tte-a4c.mp4']
            metadata = ['public/assets/probe-heart-v44/manifest.json',
                        'public/assets/tee-atlas/diagrams/me4c.svg',EXPORT.APPROVED_DOC_IMAGE]
            assets = [{'path':path,'group':'runtime','redistribution':'permitted'} for path in payloads]
            assets.append({'path':'data/example.webp','group':'fine-data','redistribution':'permitted'})
            EXPORT.ignore_restored_assets(root,assets)
            checked = subprocess.run(['git','-C',str(root),'check-ignore','--no-index','--stdin'],
                                     input='\n'.join(payloads+metadata+['.env'])+'\n',capture_output=True,text=True,check=True)
            self.assertEqual(set(checked.stdout.splitlines()),set(payloads+['.env']))

    @unittest.skipUnless(shutil.which('node'),'Node is needed to execute the actual exported controller')
    def test_exported_runtime_preserves_dataset_identity_and_never_fetches_excluded_data(self):
        files = ('public/tee-atlas-data.js','public/clinical-sources.js','public/donors.js',
                 'public/window-presets.js','public/app.js','public/dataset-browser.js',
                 'public/dataset-citations.js','public/motion-lab-v24.js','public/assets/echo-media-v6.json')
        before = {name:EXPORT.sha256(ROOT/name) for name in files}
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root/'package.json').write_text('{"type":"module"}')
            for name in files:
                target = root/name
                target.parent.mkdir(parents=True,exist_ok=True)
                shutil.copyfile(ROOT/name,target)
            shutil.copytree(ROOT/'public/assets/tee-atlas/diagrams',root/'public/assets/tee-atlas/diagrams')
            # Public distributions already have these transformations. Run the
            # same behavior checks there without reintroducing excluded art.
            if 'ready:true' in (root/'public/clinical-sources.js').read_text():
                excluded = {'public/assets/echo-media-v6/tte-psax_mitral'+ext:{} for ext in ('.mp4','.webp')}
                EXPORT.transform_runtime(root,excluded)
            script = r'''
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {donorFromSearch} from './public/donors.js';
import {TEE_ATLAS_VIEWS} from './public/tee-atlas-data.js';
const source=await readFile('./public/app.js','utf8');
const start=source.lastIndexOf('async function main(){');
const end=source.lastIndexOf('\nmain();');
assert(start>=0&&end>start);
for(const id of ['cmac-case-1','slicerheart-4d']){
 const donor=donorFromSearch('?donor='+id);
 assert.equal(donor.id,id);assert.equal(donor.ready,false);
 let calls=0,loading=null,message='';
 const document={body:{dataset:{}}};const values=new Map();
 const element={setAttribute(){}};
 const main=new Function('donor','document','setText','$','loadingState','status','fetch',
   'return ('+source.slice(start,end)+');')(
    donor,document,(id,text)=>values.set(id,text),()=>element,
    (title,detail)=>loading={title,detail},value=>message=value,
    ()=>{calls++;throw Error('Excluded asset request');});
 await main();assert.equal(calls,0);assert.equal(document.body.dataset.donor,id);
 assert.equal(loading.title,'Dataset not included');assert.match(loading.detail,/asset setup/);
 assert.match(message,/not included/);assert.equal(values.get('specimenLabel'),donor.specimen);
}
assert.equal(donorFromSearch('?donor=s-20-28').id,'s-20-28');
assert.equal(donorFromSearch('?donor=unknown').id,'ladaf-2021-17');
assert.equal(TEE_ATLAS_VIEWS.length,28);
assert(TEE_ATLAS_VIEWS.every(view=>view.illustration===view.diagram&&view.diagram.endsWith('.svg')));
const media=JSON.parse(await readFile('./public/assets/echo-media-v6.json','utf8'));
assert.equal(media.clips.length,11);assert(media.clips.every(clip=>!clip.license.includes('NC')));
assert(media.clips.some(clip=>clip.url==='./assets/echo-media-v6/tte-a3c.mp4'));
assert.equal(media.clips.filter(clip=>clip.url.startsWith('./assets/echo-media-v7/tte-')).length,5);
assert.equal(media.totalVideoBytes,media.clips.reduce((total,clip)=>total+clip.bytes,0));
'''
            subprocess.run(['node','--input-type=module','-e',script],cwd=root,check=True,capture_output=True,text=True)
        self.assertEqual(before,{name:EXPORT.sha256(ROOT/name) for name in files},'Exporting must not alter live source')


if __name__ == '__main__':
    unittest.main()
