# SPDX-License-Identifier: AGPL-3.0-only
"""Authenticate every supplied input before importing publisher model code."""
from __future__ import annotations

import hashlib
import json
import subprocess
from pathlib import Path, PurePosixPath


def digest_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def verify_file(root: Path, pin: dict) -> Path:
    relative = PurePosixPath(pin["localPath"])
    if relative.is_absolute() or ".." in relative.parts or "\\" in str(relative):
        raise ValueError("Inputs must use relative paths inside the pinned checkout")
    path = root.joinpath(*relative.parts)
    if not path.resolve().is_relative_to(root.resolve()):
        raise ValueError("Inputs must use relative paths inside the pinned checkout")
    if path.resolve() != path.absolute():
        raise ValueError(f"Input has an indirect path: {relative}")
    if not path.is_file() or path.stat().st_size != pin["byteLength"]:
        raise ValueError(f"Input length mismatch: {relative}")
    if digest_file(path) != pin["sha256"]:
        raise ValueError(f"Input digest mismatch: {relative}")
    return path


def verify_checkout(root: Path, revision: str, allowed_python=()) -> int:
    def git(*args: str) -> bytes:
        return subprocess.check_output(["git", "-C", str(root), *args])
    if git("rev-parse", "HEAD").decode().strip() != revision:
        raise ValueError("The source checkout is not at the pinned revision")
    tracked = set()
    for row in git("ls-tree", "-rz", revision).split(b"\0"):
        if not row:
            continue
        header, name = row.split(b"\t", 1)
        mode, kind, expected = header.split()
        if kind != b"blob" or mode not in (b"100644", b"100755"):
            raise ValueError("Only regular files may appear in the pinned source tree")
        path = root / name.decode()
        if path.resolve() != path.absolute() or not path.is_file():
            raise ValueError(f"Source file missing or indirect: {name.decode()}")
        data = path.read_bytes()
        blob = b"blob " + str(len(data)).encode() + b"\0" + data
        if hashlib.sha1(blob).hexdigest().encode() != expected:
            raise ValueError(f"Source file differs from pinned Git tree: {name.decode()}")
        tracked.add(name.decode())
    allowed = tracked | set(allowed_python)
    for path in root.rglob("*"):
        relative = path.relative_to(root)
        if any(part in (".git", ".cache", "__pycache__") for part in relative.parts):
            continue
        if path.is_symlink():
            raise ValueError(f"Source contains an indirect path: {relative}")
        if path.suffix == ".py" and relative.as_posix() not in allowed:
            raise ValueError(f"Untracked Python may shadow authenticated imports: {relative}")
    return len(tracked)


def verify_snapshot_inventory(root: Path, source: dict) -> list[dict]:
    snapshot = source["cradioCodeSnapshot"]
    if snapshot.get("status") != "source-pinned" or not snapshot.get("files"):
        raise ValueError("The C-RADIO executable source inventory is not authenticated")
    prefix = PurePosixPath("vfms/cradio/C-RADIOv4-SO400M")
    pins = [*snapshot["files"], *(pin for pin in source["artifacts"] if pin["component"] == "cradio")]
    expected = {pin["localPath"] for pin in pins}
    actual = set()
    for path in (root / str(prefix)).rglob("*"):
        relative = path.relative_to(root)
        if any(part in (".cache", "__pycache__") for part in relative.parts):
            continue
        if path.is_symlink():
            raise ValueError(f"Indirect C-RADIO snapshot entry: {relative}")
        if path.is_file():
            actual.add(relative.as_posix())
    if actual != expected:
        raise ValueError("C-RADIO snapshot must exactly match the authenticated file inventory")
    return snapshot["files"]


def verify_inputs(root: Path, register_path: Path) -> dict:
    register = json.loads(register_path.read_text())
    if register.get("modelId") != "corridorkey-2.0" or register.get("publicationReady") is not False:
        raise ValueError("This tool accepts only the unpublished CorridorKey candidate register")
    source = register["source"]
    snapshot_files = verify_snapshot_inventory(root, source)
    count = verify_checkout(root, source["revision"], [pin["localPath"] for pin in snapshot_files])
    for pin in [*source["artifacts"], *source["notices"]]:
        verify_file(root, pin)
    for pin in snapshot_files:
        verify_file(root, pin)
    return {"register": register, "trackedSourceFiles": count,
            "registerSha256": digest_file(register_path)}
