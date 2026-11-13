#!/usr/bin/env python3
"""Small, offline publication/activation safety fixtures; not a bank QC rerun."""
import hashlib
import importlib.util
from pathlib import Path
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('activate_bank', ROOT / 'scripts/reference-sections-v57/activate-bank.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class ActivationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.path = 'public/assets/reference-sections-v57/test.r8.gz'
        self.asset = self.root / self.path
        self.asset.parent.mkdir(parents=True)
        self.asset.write_bytes(b'verified fixture')
        self.entry = {'path': self.path, 'bytes': 16, 'sha256': hashlib.sha256(b'verified fixture').hexdigest()}

    def tearDown(self):
        self.temp.cleanup()

    def test_valid_asset(self):
        module.verify_asset(self.root, self.entry)

    def test_missing_asset(self):
        self.asset.unlink()
        with self.assertRaises(module.BankError):
            module.verify_asset(self.root, self.entry)

    def test_wrong_length(self):
        self.asset.write_bytes(b'short')
        with self.assertRaises(module.BankError):
            module.verify_asset(self.root, self.entry)

    def test_wrong_hash(self):
        self.asset.write_bytes(b'corrupt! fixture')
        with self.assertRaises(module.BankError):
            module.verify_asset(self.root, self.entry)

    def test_traversal(self):
        for relative in ('../private', '/absolute', 'public/../private', 'public//file', 'a\\b'):
            with self.subTest(relative=relative), self.assertRaises(module.BankError):
                module.checked_path(self.root, relative)

    def test_symlink(self):
        self.asset.unlink()
        source = self.root / 'other'
        source.write_bytes(b'verified fixture')
        self.asset.symlink_to(source)
        with self.assertRaises(module.BankError):
            module.verify_asset(self.root, self.entry)

    def test_missing_bank_leaves_template_unchanged(self):
        target = self.root / module.TARGET
        target.write_bytes(b'original template')
        self.assertEqual(module.main(['--root', str(self.root)]), 1)
        self.assertEqual(target.read_bytes(), b'original template')

    def test_custom_config_not_overwritten(self):
        target = self.root / module.TARGET
        target.write_bytes(b'custom configuration')
        with self.assertRaises(module.BankError):
            module.activate(self.root, b'replacement')
        self.assertEqual(target.read_bytes(), b'custom configuration')

    def test_matching_config_is_idempotent(self):
        config = (ROOT / module.CONFIG).read_bytes()
        target = self.root / module.TARGET
        target.write_bytes(config)
        self.assertFalse(module.activate(self.root, config))
        self.assertEqual(target.read_bytes(), config)

    def test_template_activation(self):
        template = b'/** Source-only configuration. The reference-section generator writes verified donor entries here. */\nexport const REFERENCE_SECTIONS=Object.freeze({});\n'
        self.assertEqual(hashlib.sha256(template).hexdigest(), module.TEMPLATE_SHA256)
        target = self.root / module.TARGET
        target.write_bytes(template)
        config = (ROOT / module.CONFIG).read_bytes()
        self.assertTrue(module.activate(self.root, config))
        self.assertEqual(target.read_bytes(), config)


if __name__ == '__main__':
    unittest.main()
