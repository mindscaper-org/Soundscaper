# SPDX-License-Identifier: AGPL-3.0-only
import hashlib
import subprocess
import tempfile
import unittest
from pathlib import Path

from framescaper_corridorkey_conversion.inputs import verify_checkout, verify_file


class InputIntegrityTests(unittest.TestCase):
    def test_verifies_exact_bytes_before_loading_models(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "model.bin").write_bytes(b"model")
            pin = {"localPath": "model.bin", "byteLength": 5,
                   "sha256": hashlib.sha256(b"model").hexdigest()}
            self.assertEqual(verify_file(root, pin), root / "model.bin")
            (root / "model.bin").write_bytes(b"other")
            with self.assertRaisesRegex(ValueError, "digest"):
                verify_file(root, pin)

    def test_refuses_paths_outside_source_checkout(self):
        with tempfile.TemporaryDirectory() as directory:
            for path in ("../model.bin", "/tmp/model.bin"):
                with self.assertRaisesRegex(ValueError, "relative"):
                    verify_file(Path(directory), {"localPath": path})

    def test_refuses_symlink_parents_even_when_target_is_inside_checkout(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "real").mkdir()
            (root / "real/model.bin").write_bytes(b"model")
            (root / "alias").symlink_to(root / "real", target_is_directory=True)
            pin = {"localPath": "alias/model.bin", "byteLength": 5,
                   "sha256": hashlib.sha256(b"model").hexdigest()}
            with self.assertRaisesRegex(ValueError, "indirect"):
                verify_file(root, pin)

    def test_refuses_untracked_executable_python(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            def git(*args):
                return subprocess.check_output(["git", "-C", directory, *args])
            git("init", "-q")
            (root / "model.py").write_text("value = 1\n")
            git("add", "model.py")
            git("-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "-qm", "fixture")
            revision = git("rev-parse", "HEAD").decode().strip()
            self.assertEqual(verify_checkout(root, revision), 1)
            (root / "shadow.py").write_text("value = 2\n")
            with self.assertRaisesRegex(ValueError, "Untracked Python"):
                verify_checkout(root, revision)


if __name__ == "__main__":
    unittest.main()
