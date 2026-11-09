"""Test two-object staging against real source bytes in isolated build fixtures."""
import importlib.util
import json
from pathlib import Path
import shutil
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location('probe_heart_staging',ROOT/'scripts/prepare-probe-heart-hosting-v44.py')
STAGE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(STAGE)


class ProbeHeartHostingTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        for name in (STAGE.INDEX, 'public/'+STAGE.MANIFEST, *('public/assets/probe-heart-v44/'+name for name in STAGE.EXPECTED)):
            source = ROOT/name
            if not source.is_file():
                self.skipTest('Restore permitted v44 runtime assets before staging tests')
            target = self.root/name
            target.parent.mkdir(parents=True,exist_ok=True)
            shutil.copyfile(source,target)
        (self.root/'dist/server').mkdir(parents=True)
        shutil.copytree(self.root/'public/assets',self.root/'dist/client/assets')
        (self.root/'dist/client/assets/probe-heart-v44/unrelated.txt').write_text('retain')
        self.write_policy('probe-heart-v44:read-only')
        self.originals = {str(path.relative_to(self.root)):STAGE.sha(path) for path in (self.root/'public').rglob('*') if path.is_file()}

    def tearDown(self):
        self.temporary.cleanup()

    def write_policy(self, policy, *, compiled=None, index=None):
        (self.root/STAGE.POLICY_SOURCE).write_text("export const probeHeartV44ReleasePolicy = '"+policy+"';\n")
        table = STAGE.EXPECTED if index is None else index
        (self.root/'dist/server/worker.js').write_text("const policy='"+(compiled or policy)+"';const message='"+STAGE.MARKER+"';const index="+json.dumps(table)+';')

    def copies(self):
        return [self.root/'dist/client/assets/probe-heart-v44'/name for name in STAGE.EXPECTED]

    def assert_sources_unchanged(self):
        self.assertEqual(self.originals,{name:STAGE.sha(self.root/name) for name in self.originals})
        self.assertEqual((self.root/'dist/client/assets/probe-heart-v44/unrelated.txt').read_text(),'retain')
        self.assertEqual((self.root/'dist/client'/STAGE.MANIFEST).read_bytes(),(self.root/'public'/STAGE.MANIFEST).read_bytes())

    def test_final_removes_only_matching_copies_and_is_idempotent(self):
        report = STAGE.stage(root=self.root)
        self.assertEqual(report['removedBuildCopies'],2)
        self.assertEqual(report['removedBuildBytes'],5746842)
        self.assertTrue(report['publicServingEnabled'])
        self.assertFalse(report['uploadsEnabled'])
        self.assertTrue(all(not path.exists() for path in self.copies()))
        self.assert_sources_unchanged()
        self.assertEqual(STAGE.stage(root=self.root)['removedBuildCopies'],0)

    def test_compiler_template_literals_keep_exact_index_identity(self):
        output=self.root/'dist/server/worker.js'
        output.write_text(output.read_text().replace('"','`'))
        self.assertEqual(STAGE.stage(root=self.root)['removedBuildCopies'],2)

    def test_seed_is_explicit_and_matches_source_and_compiled_policy(self):
        self.write_policy('probe-heart-v44:seed')
        with self.assertRaisesRegex(RuntimeError,'seed/final'):
            STAGE.stage(root=self.root)
        self.assertTrue(all(path.is_file() for path in self.copies()))
        report = STAGE.stage(root=self.root,seed=True)
        self.assertEqual(report['removedBuildCopies'],2)
        self.assertFalse(report['publicServingEnabled'])
        self.assertTrue(report['uploadsEnabled'])
        self.assert_sources_unchanged()

    def test_stale_compiled_policy_or_index_never_removes_a_copy(self):
        self.write_policy('probe-heart-v44:read-only',compiled='probe-heart-v44:seed')
        with self.assertRaisesRegex(RuntimeError,'stale or conflicting'):
            STAGE.stage(root=self.root)
        self.assertTrue(all(path.is_file() for path in self.copies()))
        index = json.loads(json.dumps(STAGE.EXPECTED))
        next(iter(index.values()))['bytes'] += 1
        self.write_policy('probe-heart-v44:read-only',index=index)
        with self.assertRaisesRegex(RuntimeError,'stale probe-heart index'):
            STAGE.stage(root=self.root)
        self.assertTrue(all(path.is_file() for path in self.copies()))

    def test_second_corrupt_mesh_does_not_partially_remove_first(self):
        self.copies()[1].write_bytes(b'corrupt build')
        with self.assertRaisesRegex(RuntimeError,'SHA-256'):
            STAGE.stage(root=self.root)
        self.assertTrue(all(path.is_file() for path in self.copies()))
        self.assert_sources_unchanged()

    def test_manifest_or_source_index_mismatch_preserves_build(self):
        manifest = self.root/'dist/client'/STAGE.MANIFEST
        original = manifest.read_text()
        manifest.write_text(original+'\n')
        with self.assertRaisesRegex(RuntimeError,'built whole-heart manifest'):
            STAGE.stage(root=self.root)
        manifest.write_text(original)
        index = json.loads((self.root/STAGE.INDEX).read_text())
        index['extra.hfm.gz'] = next(iter(index.values()))
        (self.root/STAGE.INDEX).write_text(json.dumps(index))
        with self.assertRaisesRegex(RuntimeError,'exactly the two'):
            STAGE.stage(root=self.root)
        self.assertTrue(all(path.is_file() for path in self.copies()))

    def test_symlink_and_non_directory_receipt_paths_prevent_removal(self):
        target = self.copies()[1]
        saved = target.read_bytes()
        target.unlink()
        target.symlink_to(self.root/'public/assets/probe-heart-v44'/target.name)
        with self.assertRaisesRegex(RuntimeError,'symbolic staging path'):
            STAGE.stage(root=self.root)
        self.assertTrue(self.copies()[0].is_file())
        target.unlink()
        target.write_bytes(saved)
        (self.root/'.sites-runtime').write_text('not a directory')
        with self.assertRaisesRegex(RuntimeError,'Non-directory'):
            STAGE.stage(root=self.root)
        self.assertTrue(all(path.is_file() for path in self.copies()))
        self.assert_sources_unchanged()


if __name__ == '__main__':
    unittest.main()
