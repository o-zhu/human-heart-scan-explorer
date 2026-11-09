#!/usr/bin/env python3
"""Read-only staging-plan tests. Never invokes stage() or modifies real dist."""
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT/'scripts/prepare-bundled-json-v1.py'
spec = importlib.util.spec_from_file_location('bundled_json_stage', SCRIPT)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class StagingPlanTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        for position, relative in enumerate(module.CATALOGS):
            source = self.root/'public'/relative
            source.parent.mkdir(parents=True, exist_ok=True)
            source.write_bytes((' { "n" : 1.0, "text" : "keep  spaces '+str(position)+'" } \n').encode())
            target = self.root/'dist/client'/relative
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(module.compact(source.read_bytes()))
        self.index = module.create_index(self.root)
        self.save_index()
        self.worker = self.root/'dist/server/index.js'
        self.worker.parent.mkdir(parents=True, exist_ok=True)
        # These are fixture markers for checking the staging guard, not a
        # simulated Worker execution; runtime behavior is tested separately.
        self.worker.write_text(module.POLICY+' x-heart-json-transport DecompressionStream '+json.dumps(self.index))

    def save_index(self):
        target = self.root/module.INDEX
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(json.dumps(self.index))

    def test_valid_plan_is_read_only_and_accepts_only_lexical_whitespace(self):
        plans, report = module.prepare_stage(self.root)
        self.assertEqual(len(plans), 8)
        self.assertTrue(report['builtWorkerVerified'])
        for relative, raw, built in plans:
            self.assertEqual((self.root/'public'/relative).read_bytes(), raw)
            self.assertEqual((self.root/'dist/client'/relative).read_bytes(), built)
        target = self.root/'dist/client'/module.CATALOGS[-1]
        target.write_bytes(target.read_bytes().replace(b'1.0', b'1.00'))
        with self.assertRaisesRegex(AssertionError, 'beyond whitespace'):
            module.prepare_stage(self.root)
        self.assertTrue(all((self.root/'dist/client'/p).is_file() for p in module.CATALOGS))

    def test_existing_staged_absence_is_idempotent(self):
        (self.root/'dist/client'/module.CATALOGS[0]).unlink()
        plans, report = module.prepare_stage(self.root)
        self.assertIsNone(plans[0][2])
        self.assertTrue(report['files'][0]['alreadyStaged'])

    def test_missing_handler_or_stale_compiled_payload_blocks_removal(self):
        complete = self.worker.read_text()
        self.worker.write_text(complete.replace('x-heart-json-transport', 'not-the-handler'))
        with self.assertRaisesRegex(AssertionError, 'lacks'):
            module.prepare_stage(self.root)
        first = self.index['files']['/'+module.CATALOGS[0]]['gzipBase64']
        self.worker.write_text(complete.replace(first, 'stale'))
        with self.assertRaisesRegex(AssertionError, 'exact bundled payload'):
            module.prepare_stage(self.root)
        self.assertTrue(all((self.root/'dist/client'/p).is_file() for p in module.CATALOGS))

    def test_source_or_allowlist_change_blocks_removal(self):
        path = self.root/'public'/module.CATALOGS[0]
        original = path.read_bytes()
        path.write_bytes(original+b'\n')
        with self.assertRaisesRegex(AssertionError, 'exact source'):
            module.prepare_stage(self.root)
        path.write_bytes(original)
        self.index['files']['/assets/unapproved.json'] = next(iter(self.index['files'].values()))
        self.save_index()
        with self.assertRaisesRegex(AssertionError, 'allowlist'):
            module.prepare_stage(self.root)

    def test_optimized_python_is_rejected_before_any_action(self):
        command = 'import runpy; runpy.run_path('+repr(str(SCRIPT))+', run_name="optimized_guard")'
        result = subprocess.run([sys.executable, '-O', '-c', command], capture_output=True, text=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('do not use -O', result.stderr)


if __name__ == '__main__':
    unittest.main()
