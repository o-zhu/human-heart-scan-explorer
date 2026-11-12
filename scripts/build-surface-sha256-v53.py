#!/usr/bin/env python3
"""Build the project's small scalar SHA-256 compressor without a toolchain.

This is an original translation of public/surface-sha256.js into WebAssembly
integer operations, not a bundled third-party hash implementation. It emits a
readable WAT companion and embeds the identical binary in that JS module.

Only the compression function is accelerated. The existing JS object owns
length, incomplete blocks, final padding and result formatting. One fixed
64 KiB Wasm page contains the eight working state words and a <=63 KiB input
window. Sixteen local schedule words rotate through the standard 64 rounds.
There are no imports, threads, SIMD instructions, allocator or memory.grow.

Run with --check in validation to prove the checked-in source is reproducible.
"""
from __future__ import annotations

import argparse
import base64
import hashlib
import json
from pathlib import Path
import re


ROOT = Path(__file__).resolve().parents[1]
JAVASCRIPT = ROOT / "public/surface-sha256.js"
WAT = ROOT / "docs/surface-hash-v53/surface-sha256.wat"
BEGIN = "// BEGIN GENERATED SURFACE SHA-256 WASM"
END = "// END GENERATED SURFACE SHA-256 WASM"
INPUT_OFFSET = 1024
INPUT_BYTES = 65536 - INPUT_OFFSET
NAMES = ["length", "offset", *"abcdefgh", "x", "t1", *[f"w{i}" for i in range(16)]]
LOCAL = {name: index for index, name in enumerate(NAMES)}
OPCODES = {"add": 0x6A, "and": 0x71, "or": 0x72, "xor": 0x73,
           "shr_u": 0x76, "rotr": 0x78, "gt_u": 0x4B, "ge_u": 0x4F}


def unsigned_leb(value: int) -> bytes:
    output = bytearray()
    while True:
        byte = value & 127
        value >>= 7
        output.append(byte | (128 if value else 0))
        if not value:
            return bytes(output)


def signed_i32_leb(value: int) -> bytes:
    value &= 0xFFFFFFFF
    if value >= 2**31:
        value -= 2**32
    output = bytearray()
    while True:
        byte = value & 127
        value >>= 7
        done = value == 0 and not byte & 64 or value == -1 and byte & 64
        output.append(byte | (0 if done else 128))
        if done:
            return bytes(output)


def vector(items: list[bytes]) -> bytes:
    return unsigned_leb(len(items)) + b"".join(items)


def string(value: str) -> bytes:
    encoded = value.encode("utf-8")
    return unsigned_leb(len(encoded)) + encoded


def constant(value):
    return ("const", value)


def get(name):
    return ("get", name)


def operation(name, *values):
    if len(values) > 2:
        return operation(name, operation(name, *values[:-1]), values[-1])
    return (name, *values)


def add(*values):
    return operation("add", *values)


def xor(*values):
    return operation("xor", *values)


def load(address):
    return ("load", address)


def rotate(value, bits):
    return operation("rotr", value, constant(bits))


def sigma(value, rotate_a, rotate_b, shift):
    return xor(rotate(value, rotate_a), rotate(value, rotate_b), operation("shr_u", value, constant(shift)))


def expression(node):
    name, *values = node
    if name == "const":
        return b"\x41" + signed_i32_leb(values[0]), f"(i32.const {values[0]})"
    if name == "get":
        return b"\x20" + unsigned_leb(LOCAL[values[0]]), f"(local.get ${values[0]})"
    arguments = [expression(value) for value in values]
    encoded = b"".join(item[0] for item in arguments)
    written = " ".join(item[1] for item in arguments)
    if name == "load":
        return encoded + b"\x28\x02\x00", f"(i32.load {written})"
    return encoded + bytes([OPCODES[name]]), f"(i32.{name} {written})"


class Function:
    def __init__(self):
        self.binary = bytearray()
        self.lines = []
        self.indent = 4

    def line(self, text):
        self.lines.append(" " * self.indent + text)

    def set(self, name, value):
        encoded, written = expression(value)
        self.binary.extend(encoded + b"\x21" + unsigned_leb(LOCAL[name]))
        self.line(f"(local.set ${name} {written})")

    def store(self, address, value):
        encoded_address, written_address = expression(address)
        encoded_value, written_value = expression(value)
        self.binary.extend(encoded_address + encoded_value + b"\x36\x02\x00")
        self.line(f"(i32.store {written_address} {written_value})")


def build(round_constants):
    f = Function()
    # Fail closed if an internal caller supplies a non-block or oversized span.
    invalid = operation("or", operation("gt_u", get("length"), constant(INPUT_BYTES)),
                        operation("and", get("length"), constant(63)))
    encoded, written = expression(invalid)
    f.binary.extend(encoded + b"\x04\x40\x00\x0b")
    f.line(f"(if {written} (then unreachable))")
    f.set("offset", constant(0))
    f.binary.extend(b"\x02\x40\x03\x40")
    f.line("(block $complete"); f.indent += 2
    f.line("(loop $blocks"); f.indent += 2
    encoded, written = expression(operation("ge_u", get("offset"), get("length")))
    f.binary.extend(encoded + b"\x0d\x01")
    f.line(f"(br_if $complete {written})")

    for index, name in enumerate("abcdefgh"):
        f.set(name, load(constant(index * 4)))
    roles = list("abcdefgh")
    for index in range(64):
        f.line(f";; SHA-256 round {index}")
        word = f"w{index % 16}"
        if index < 16:
            f.set("x", load(add(constant(INPUT_OFFSET + index * 4), get("offset"))))
            # Wasm loads little-endian; SHA-256 message words are big-endian.
            f.set(word, operation("or", operation("and", rotate(get("x"), 8), constant(0xFF00FF00)),
                                 operation("and", rotate(get("x"), 24), constant(0x00FF00FF))))
        else:
            x, y = get(f"w{(index - 15) % 16}"), get(f"w{(index - 2) % 16}")
            f.set(word, add(get(word), sigma(x, 7, 18, 3), get(f"w{(index - 7) % 16}"), sigma(y, 17, 19, 10)))
        a, b, c, d, e, ff, g, h = [get(name) for name in roles]
        choose = xor(operation("and", e, ff), operation("and", xor(e, constant(-1)), g))
        majority = xor(operation("and", a, b), operation("and", a, c), operation("and", b, c))
        f.set("t1", add(h, xor(rotate(e, 6), rotate(e, 11), rotate(e, 25)), choose,
                        constant(round_constants[index]), get(word)))
        f.set(roles[3], add(d, get("t1")))
        f.set(roles[7], add(get("t1"), xor(rotate(a, 2), rotate(a, 13), rotate(a, 22)), majority))
        # Rotate names instead of copying eight local values every round.
        roles.insert(0, roles.pop())
    assert roles == list("abcdefgh")
    for index, name in enumerate("abcdefgh"):
        f.store(constant(index * 4), add(load(constant(index * 4)), get(name)))
    f.set("offset", add(get("offset"), constant(64)))
    f.binary.extend(b"\x0c\x00\x0b\x0b\x0b")
    f.line("(br $blocks)")
    f.indent -= 2; f.line(")")
    f.indent -= 2; f.line(")")

    body = vector([unsigned_leb(len(NAMES) - 1) + b"\x7f"]) + f.binary
    sections = [
        (1, vector([b"\x60" + vector([b"\x7f"]) + vector([])])),
        (3, vector([unsigned_leb(0)])),
        (5, vector([b"\x01" + unsigned_leb(1) + unsigned_leb(1)])),
        (7, vector([string("memory") + b"\x02\x00", string("compress") + b"\x00\x00"])),
        (10, vector([unsigned_leb(len(body)) + body])),
    ]
    binary = b"\x00asm\x01\x00\x00\x00" + b"".join(bytes([section]) + unsigned_leb(len(data)) + data for section, data in sections)
    locals_text = "\n".join(f"    (local ${name} i32)" for name in NAMES[1:])
    wat = ";; Generated by scripts/build-surface-sha256-v53.py; no imports, fixed memory.\n"
    wat += '(module\n  (memory (export "memory") 1 1)\n  (func (export "compress") (param $length i32)\n'
    wat += locals_text + "\n" + "\n".join(f.lines) + "\n  )\n)\n"
    return binary, wat


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    source = JAVASCRIPT.read_text()
    constants = re.search(r"const K=new Uint32Array\(\[([\s\S]+?)\]\);", source)
    if not constants:
        raise SystemExit("The reviewed SHA-256 round constants were not found.")
    rounds = [int(value.strip(), 16) for value in constants[1].split(",") if value.strip()]
    if len(rounds) != 64:
        raise SystemExit("SHA-256 must have exactly 64 round constants.")
    binary, wat = build(rounds)
    encoded = base64.b64encode(binary).decode("ascii")
    lines = [encoded[index:index + 120] for index in range(0, len(encoded), 120)]
    generated = BEGIN + "\n// Rebuild with python3 scripts/build-surface-sha256-v53.py.\n"
    generated += "const surfaceHashWasmBase64=\n " + "+\n ".join(repr(line) for line in lines) + ";\n" + END
    updated, count = re.subn(re.escape(BEGIN) + r"[\s\S]*?" + re.escape(END), lambda _: generated, source)
    if count != 1:
        raise SystemExit("Expected exactly one generated hash module region.")
    if args.check:
        if updated != source or not WAT.exists() or WAT.read_text() != wat:
            raise SystemExit("Surface hash generated files are stale.")
    else:
        JAVASCRIPT.write_text(updated)
        WAT.parent.mkdir(parents=True, exist_ok=True)
        WAT.write_text(wat)
    print(json.dumps({"wasmBytes": len(binary), "wasmSha256": hashlib.sha256(binary).hexdigest(),
                      "sharedMemoryBytes": 65536, "maximumInputCopyBytes": INPUT_BYTES, "reproducible": True}))


if __name__ == "__main__":
    main()
