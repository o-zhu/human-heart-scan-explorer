#!/usr/bin/env python3
"""Create, verify, and cautiously apply Heart Explorer source delta bundles.

Standard library only. This tool never executes archive instructions, commits,
pushes, or resolves conflicts. Review licensing/secrets and dependency records
separately. The external ZIP hash is an integrity check, not a signature.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import stat
import subprocess
import sys
import tempfile
import zipfile

LIMIT = 512 * 1024 * 1024
RESERVED = {".git", ".svn", "node_modules", "dist", "build", ".cache", "__pycache__", ".venv", ".sites-checkout", ".pnpm-store"}
DOCS = {"changes.patch", "DIFF.md", "CODEX_PROMPT.md", "VALIDATION.md"}


def fail(message):
    raise ValueError(message)


def sha(data):
    return hashlib.sha256(data).hexdigest()


def safe_path(value, source=False):
    if not isinstance(value, str) or not value or any(ord(c) < 32 for c in value):
        fail("Invalid or empty path")
    p = PurePosixPath(value)
    if "\\" in value or ":" in value or p.is_absolute() or str(p) != value or any(x in {".", ".."} for x in p.parts):
        fail("Unsafe archive/source path: " + value)
    if any(x.lower() in RESERVED for x in p.parts):
        fail("Excluded source/build/cache path: " + value)
    if source:
        name = p.name.lower()
        if (name == ".env" or (name.startswith(".env.") and name.rsplit(".", 1)[-1] not in {"example", "sample", "template"})
                or name in {"id_rsa", "id_ed25519", "credentials.json", "credentials.ini"}
                or p.suffix.lower() in {".pem", ".key", ".p12", ".pfx"}):
            fail("Excluded credential path: " + value)
    return value


def git(repo, *args):
    return subprocess.run(["git", "-C", str(repo), *args], check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE).stdout


def blob(repo, ref, path, max_size):
    entry = git(repo, "ls-tree", "-z", ref, "--", path).rstrip(b"\0")
    if not entry:
        return None, None
    info, tree_path = entry.split(b"\t", 1)
    mode, kind, oid = info.decode().split()
    if tree_path.decode() != path or kind != "blob" or mode not in {"100644", "100755"}:
        fail("Only ordinary files can be packaged: " + path)
    if int(git(repo, "cat-file", "-s", oid)) > max_size:
        fail("File exceeds the explicit per-file budget: " + path)
    return git(repo, "cat-file", "blob", oid), mode


def text_file(path, default):
    return Path(path).read_bytes() if path else default.encode()


def create(args):
    repo = Path(args.repo).resolve()
    base = git(repo, "rev-parse", "--verify", args.base_ref + "^{commit}").decode().strip()
    target = git(repo, "rev-parse", "--verify", args.target_ref + "^{commit}").decode().strip()
    selected = [safe_path(p, True) for p in args.paths]
    if len(set(selected)) != len(selected):
        fail("Duplicate selected paths")
    changed = set(git(repo, "diff", "--no-renames", "--name-only", "-z", base, target).decode().rstrip("\0").split("\0"))
    if not selected or any(p not in changed for p in selected):
        fail("Every --paths entry must name an actual changed file")
    metadata = json.loads(Path(args.metadata).read_text())
    if not isinstance(metadata, dict) or metadata.get("schema_version") != 1 or metadata.get("project") != "heart-explorer":
        fail("Metadata requires schema_version: 1 and project: heart-explorer")
    if not isinstance(metadata.get("update_id"), str) or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.-]{2,160}", metadata["update_id"]):
        fail("Metadata requires a safe, unique update_id")
    if any(k in metadata for k in ("files", "archive_members", "base_source_commit", "target_source_commit")):
        fail("Metadata must not supply generated integrity fields")
    members, files = {}, []
    for path in sorted(selected):
        before, before_mode = blob(repo, base, path, args.max_file_mib * 1024 * 1024)
        after, after_mode = blob(repo, target, path, args.max_file_mib * 1024 * 1024)
        if before == after and before_mode == after_mode:
            fail("Selected path has no actual change: " + path)
        item = {"path": path, "operation": "add" if before is None else "delete" if after is None else "modify"}
        for label, content, mode, prefix in (("before", before, before_mode, "base"), ("after", after, after_mode, "payload")):
            member = prefix + "/" + path if content is not None else None
            item.update({label + "_sha256": sha(content) if content is not None else None,
                         label + "_size": len(content) if content is not None else None,
                         label + "_mode": mode, prefix: member})
            if member:
                members[member] = content
        files.append(item)
    members["changes.patch"] = git(repo, "diff", "--no-ext-diff", "--no-textconv", "--binary", "--full-index", "--no-renames", base, target, "--", *selected)
    summary = "# Update diff\n\n" + "\n".join("- " + x["operation"] + " `" + x["path"] + "`" for x in files) + "\n"
    members["DIFF.md"] = text_file(args.diff_log, summary)
    members["CODEX_PROMPT.md"] = text_file(args.prompt, "# Integration\n\nRead the project update workflow, verify the bundle and all dependencies, then apply in an isolated checkout. Review conflicts using base/ and payload/. Do not overwrite unrelated work.\n")
    members["VALIDATION.md"] = text_file(args.validation, "# Validation\n\nNo application validation results supplied. Verify before integration.\n")
    metadata.update(base_source_commit=base, target_source_commit=target, files=files,
                    archive_members={p: {"sha256": sha(b), "size": len(b)} for p, b in sorted(members.items())})
    members["manifest.json"] = (json.dumps(metadata, indent=2, sort_keys=True) + "\n").encode()
    if sum(map(len, members.values())) > LIMIT:
        fail("Bundle exceeds the 512 MiB unpacked limit; split large asset packages")
    output = Path(args.output).resolve()
    sidecar = Path(str(output) + ".sha256")
    if output.exists() or sidecar.exists():
        fail("Immutable output already exists; use a new update ID/path")
    output.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(output, "x", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as z:
        for name, content in sorted(members.items()):
            info = zipfile.ZipInfo(name, date_time=(1980, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = (stat.S_IFREG | 0o644) << 16
            z.writestr(info, content)
    verify(output)
    digest = sha(output.read_bytes())
    with sidecar.open("x") as f:
        f.write(digest + "  " + output.name + "\n")
    return {"status": "created", "update_id": metadata["update_id"], "archive": str(output), "sha256": digest,
            "checksum_file": str(sidecar), "files": len(files), "bytes": output.stat().st_size}


def verify(path, expected=None):
    path = Path(path)
    if path.stat().st_size > LIMIT:
        fail("Archive exceeds the 512 MiB input limit")
    archive_sha = sha(path.read_bytes())
    if expected and (not re.fullmatch(r"[0-9a-fA-F]{64}", expected) or archive_sha != expected.lower()):
        fail("External archive SHA-256 mismatch")
    with zipfile.ZipFile(path) as z:
        entries = z.infolist()
        if len(entries) > 5000 or sum(i.file_size for i in entries) > LIMIT:
            fail("Archive exceeds member or unpacked limits")
        names = [safe_path(i.filename) for i in entries]
        if len(names) != len(set(names)) or len(names) != len(set(n.casefold() for n in names)):
            fail("Duplicate or case-colliding archive members")
        for i in entries:
            mode = i.external_attr >> 16
            if (i.is_dir() or stat.S_IFMT(mode) not in {0, stat.S_IFREG} or i.flag_bits & 1
                    or i.compress_type not in {zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED}):
                fail("Unsupported, encrypted, directory, or non-regular ZIP member: " + i.filename)
        if "manifest.json" not in names or z.getinfo("manifest.json").file_size > 1024 * 1024:
            fail("Missing or oversized manifest")
        manifest_bytes = z.read("manifest.json")
        m = json.loads(manifest_bytes)
        if not isinstance(m, dict) or m.get("schema_version") != 1 or m.get("project") != "heart-explorer" or not isinstance(m.get("update_id"), str):
            fail("Unsupported project/schema or missing update ID")
        index, rows = m.get("archive_members"), m.get("files")
        if not isinstance(index, dict) or not isinstance(rows, list) or not rows:
            fail("Missing member index or file list")
        if set(index) != set(names) - {"manifest.json"} or not DOCS.issubset(index):
            fail("ZIP members differ from the manifest index")
        contents = {}
        for name, record in index.items():
            data = z.read(name)
            if not isinstance(record, dict) or record.get("size") != len(data) or record.get("sha256") != sha(data):
                fail("Member digest or size mismatch: " + name)
            contents[name] = data
    used, paths = set(DOCS), set()
    for row in rows:
        if not isinstance(row, dict):
            fail("Invalid file record")
        p = safe_path(row.get("path"), True)
        if p.casefold() in paths:
            fail("Duplicate or case-colliding target path: " + p)
        paths.add(p.casefold())
        operation = row.get("operation")
        if operation not in {"add", "modify", "delete"}:
            fail("Unsupported operation: " + str(operation))
        for side, prefix, needed in (("before", "base", operation != "add"), ("after", "payload", operation != "delete")):
            member = row.get(prefix)
            if not needed:
                if any(row.get(k) is not None for k in (prefix, side + "_mode", side + "_sha256", side + "_size")):
                    fail("Absent file side has unexpected data: " + p)
                continue
            if member != prefix + "/" + p or member not in contents:
                fail("Invalid base/payload mapping: " + p)
            data = contents[member]
            if row.get(side + "_mode") not in {"100644", "100755"} or row.get(side + "_size") != len(data) or row.get(side + "_sha256") != sha(data):
                fail("File-side metadata mismatch: " + p)
            used.add(member)
    if used != set(contents):
        fail("Unmapped archive members")
    for p in paths:
        if any(str(parent) in paths for parent in PurePosixPath(p).parents if str(parent) != "."):
            fail("File/directory collision among target paths: " + p)
    return m, contents, {"status": "verified", "update_id": m["update_id"], "archive_sha256": archive_sha,
                         "manifest_sha256": sha(manifest_bytes), "files": len(rows)}


def destination(repo, relative):
    p = repo
    parts = PurePosixPath(relative).parts
    for i, segment in enumerate(parts):
        p = p / segment
        if p.is_symlink():
            fail("Refusing symlink destination or parent: " + str(p))
        if i < len(parts) - 1 and p.exists() and not p.is_dir():
            fail("Destination parent is not a directory: " + str(p))
    if p.exists() and not p.is_file():
        fail("Destination is not an ordinary file: " + str(p))
    return p


def write_atomic(path, content, mode):
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temp = tempfile.mkstemp(prefix=".heart-update-", dir=path.parent)
    try:
        with os.fdopen(fd, "wb") as f:
            f.write(content)
        os.chmod(temp, int(mode, 8) & 0o777)
        os.replace(temp, path)
    finally:
        if os.path.exists(temp):
            os.unlink(temp)


def apply(args):
    m, contents, receipt = verify(args.archive, args.expected_sha256)
    repo = Path(args.repo).resolve()
    if not repo.is_dir():
        fail("Target repository directory does not exist")
    changes, states, conflicts = [], [], []
    for row in m["files"]:
        p = destination(repo, row["path"])
        old = p.read_bytes() if p.exists() else None
        old_sha = sha(old) if old is not None else None
        old_mode = ("100755" if p.stat().st_mode & 0o111 else "100644") if old is not None else None
        before = old_sha == row["before_sha256"] and old_mode == row["before_mode"]
        after = old_sha == row["after_sha256"] and old_mode == row["after_mode"]
        state = "already-applied" if after else "ready" if before else "conflict"
        states.append({"path": row["path"], "state": state})
        if state == "conflict":
            conflicts.append(row["path"])
        elif state == "ready":
            changes.append((p, old, old_mode, row))
    if conflicts:
        fail("No files changed. Base conflict in: " + ", ".join(conflicts) + ". Review a three-way merge using base/ and payload/ in an isolated checkout.")
    receipt.update(status="dry-run" if args.dry_run else "applied", files=states)
    if args.dry_run:
        return receipt
    completed = []
    try:
        for p, old, old_mode, row in changes:
            completed.append((p, old, old_mode))
            if row["operation"] == "delete":
                p.unlink()
            else:
                write_atomic(p, contents[row["payload"]], row["after_mode"])
    except Exception as exc:
        errors = []
        for p, old, mode in reversed(completed):
            try:
                if old is None:
                    p.unlink(missing_ok=True)
                else:
                    write_atomic(p, old, mode)
            except Exception as rollback_error:
                errors.append(str(rollback_error))
        fail("Apply failed: " + str(exc) + "; rollback " + ("completed" if not errors else "incomplete: " + "; ".join(errors)))
    return receipt


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    c = sub.add_parser("create")
    for name in ("repo", "base-ref", "target-ref", "metadata", "output"):
        c.add_argument("--" + name, required=True)
    c.add_argument("--paths", nargs="+", required=True)
    c.add_argument("--max-file-mib", type=int, default=20)
    for name in ("diff-log", "prompt", "validation"):
        c.add_argument("--" + name)
    for name in ("verify", "apply"):
        p = sub.add_parser(name)
        p.add_argument("archive")
        p.add_argument("--expected-sha256")
        if name == "apply":
            p.add_argument("--repo", required=True)
            p.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    try:
        result = create(args) if args.command == "create" else apply(args) if args.command == "apply" else verify(args.archive, args.expected_sha256)[2]
        print(json.dumps(result, indent=2))
    except (ValueError, OSError, KeyError, TypeError, zipfile.BadZipFile, subprocess.CalledProcessError) as exc:
        print(json.dumps({"status": "error", "error": str(exc)}), file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
