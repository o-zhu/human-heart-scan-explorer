"""Focused integrity and preservation checks for the standalone delta helper."""
import json
import os
from pathlib import Path
import shutil
import stat
import subprocess
import tempfile
import unittest
import zipfile

SCRIPT = Path(__file__).with_name("update_bundle.py")
if not SCRIPT.exists():
    SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "update_bundle.py"


class Bundles(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.repo = self.root / "source"
        self.repo.mkdir()
        self.git("init", "-q")
        self.git("config", "user.name", "Bundle Test")
        self.git("config", "user.email", "bundle-test@example.invalid")
        (self.repo / "a.txt").write_text("before\n")
        (self.repo / "gone.txt").write_text("remove\n")
        (self.repo / "unchanged.txt").write_text("keep\n")
        self.git("add", ".")
        self.git("commit", "-qm", "base")
        self.base = self.git("rev-parse", "HEAD").strip()
        self.dest = self.root / "destination"
        shutil.copytree(self.repo, self.dest, ignore=shutil.ignore_patterns(".git"))
        (self.repo / "a.txt").write_text("after\n")
        (self.repo / "gone.txt").unlink()
        (self.repo / "new.txt").write_text("added\n")
        self.git("add", "-A")
        self.git("commit", "-qm", "target")
        metadata = self.root / "metadata.json"
        metadata.write_text(json.dumps({"schema_version": 1, "project": "heart-explorer", "update_id": "heart-v0080-test", "parent_update_ids": []}))
        self.bundle = self.root / "bundle.zip"
        self.run_cli("create", "--repo", self.repo, "--base-ref", self.base, "--target-ref", "HEAD", "--metadata", metadata,
                     "--output", self.bundle, "--paths", "a.txt", "gone.txt", "new.txt")

    def tearDown(self):
        self.temp.cleanup()

    def git(self, *args):
        return subprocess.check_output(["git", "-C", str(self.repo), *args], text=True)

    def run_cli(self, *args, success=True):
        r = subprocess.run([os.sys.executable, str(SCRIPT), *map(str, args)], capture_output=True, text=True)
        self.assertEqual(r.returncode == 0, success, r.stdout + r.stderr)
        return json.loads(r.stdout if r.returncode == 0 else r.stderr)

    def rewrite(self, name, replace=None, addition=None):
        altered = self.root / name
        with zipfile.ZipFile(self.bundle) as src, zipfile.ZipFile(altered, "w") as dst:
            for entry in src.infolist():
                data = src.read(entry.filename)
                if replace and entry.filename == replace[0]:
                    data = replace[1]
                dst.writestr(entry, data)
            if addition:
                dst.writestr(*addition)
        return altered

    def test_roundtrip_deletion_and_idempotence(self):
        digest = Path(str(self.bundle) + ".sha256").read_text().split()[0]
        result = self.run_cli("verify", self.bundle, "--expected-sha256", digest)
        self.assertEqual(result["status"], "verified")
        dry = self.run_cli("apply", self.bundle, "--repo", self.dest, "--dry-run")
        self.assertTrue(all(x["state"] == "ready" for x in dry["files"]))
        self.assertEqual((self.dest / "a.txt").read_text(), "before\n")
        self.run_cli("apply", self.bundle, "--repo", self.dest)
        self.assertEqual((self.dest / "a.txt").read_text(), "after\n")
        self.assertFalse((self.dest / "gone.txt").exists())
        self.assertEqual((self.dest / "new.txt").read_text(), "added\n")
        again = self.run_cli("apply", self.bundle, "--repo", self.dest)
        self.assertTrue(all(x["state"] == "already-applied" for x in again["files"]))
        self.assertEqual((self.dest / "unchanged.txt").read_text(), "keep\n")

    def test_member_tamper_rejected(self):
        altered = self.rewrite("tampered.zip", replace=("payload/a.txt", b"injected\n"))
        self.run_cli("verify", altered, success=False)
        self.run_cli("apply", altered, "--repo", self.dest, success=False)
        self.assertEqual((self.dest / "a.txt").read_text(), "before\n")

    def test_external_hash_mismatch_rejected(self):
        self.run_cli("verify", self.bundle, "--expected-sha256", "0" * 64, success=False)

    def test_traversal_and_archive_symlink_rejected(self):
        bad = self.rewrite("traversal.zip", addition=("../outside.txt", b"bad"))
        self.run_cli("verify", bad, success=False)
        entry = zipfile.ZipInfo("payload/link")
        entry.create_system = 3
        entry.external_attr = (stat.S_IFLNK | 0o777) << 16
        bad = self.rewrite("symlink.zip", addition=(entry, b"../../outside"))
        self.run_cli("verify", bad, success=False)

    def test_base_conflict_preserves_all_paths(self):
        (self.dest / "gone.txt").write_text("local user change\n")
        result = self.run_cli("apply", self.bundle, "--repo", self.dest, success=False)
        self.assertIn("No files changed", result["error"])
        self.assertEqual((self.dest / "a.txt").read_text(), "before\n")
        self.assertEqual((self.dest / "gone.txt").read_text(), "local user change\n")
        self.assertFalse((self.dest / "new.txt").exists())

    def test_target_symlink_rejected(self):
        (self.dest / "a.txt").unlink()
        outside = self.root / "outside.txt"
        outside.write_text("before\n")
        (self.dest / "a.txt").symlink_to(outside)
        self.run_cli("apply", self.bundle, "--repo", self.dest, success=False)
        self.assertEqual(outside.read_text(), "before\n")
        self.assertTrue((self.dest / "gone.txt").exists())

    def test_immutable_output_not_overwritten(self):
        old = self.bundle.read_bytes()
        self.run_cli("create", "--repo", self.repo, "--base-ref", self.base, "--target-ref", "HEAD", "--metadata", self.root / "metadata.json",
                     "--output", self.bundle, "--paths", "a.txt", success=False)
        self.assertEqual(old, self.bundle.read_bytes())


if __name__ == "__main__":
    unittest.main()
