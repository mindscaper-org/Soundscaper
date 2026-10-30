# SPDX-License-Identifier: AGPL-3.0-only
"""Run with uv run --frozen --project <tool-directory> python -m framescaper_corridorkey_conversion."""
from __future__ import annotations

import argparse
import contextlib
import importlib.metadata
import json
import os
import sys
import tempfile
from pathlib import Path

from .inputs import digest_file, verify_inputs


def main() -> None:
    os.environ["PYTHONDONTWRITEBYTECODE"] = "1"
    sys.dont_write_bytecode = True
    parser = argparse.ArgumentParser(description="Authenticate and export local CorridorKey candidates; never publishes models.")
    parser.add_argument("--source-root", type=Path, required=True, help="Unmodified pinned publisher Git checkout with downloaded weights")
    parser.add_argument("--register", type=Path, default=Path(__file__).resolve().parents[4] / "config/framescaper-corridorkey-model-source-candidate.json")
    parser.add_argument("--output", type=Path, required=True, help="Local candidate output directory")
    parser.add_argument("--graph", action="append", choices=("cradio", "moge", "rvm", "stage1", "stage2"), help="Export selected graphs; the default exports all five")
    parser.add_argument("--threads", type=int, default=4)
    args = parser.parse_args()
    if args.threads < 1:
        parser.error("--threads must be positive")
    evidence = verify_inputs(args.source_root.resolve(), args.register.resolve())
    print("All publisher inputs authenticated; exporting local candidates only.", flush=True)
    import torch
    from .runner import run_conversion
    torch.set_num_threads(args.threads)
    args.output.mkdir(parents=True, exist_ok=True)
    tool_root = Path(__file__).resolve().parents[1]
    tool_files = [tool_root / "pyproject.toml", *sorted((tool_root / "framescaper_corridorkey_conversion").glob("*.py"))]
    report = {"schemaVersion": 1, "status": "candidate", "publicationReady": False,
              "modelId": evidence["register"]["modelId"], "sourceRevision": evidence["register"]["source"]["revision"],
              "registerSha256": evidence["registerSha256"], "trackedSourceFiles": evidence["trackedSourceFiles"],
              "toolchainLockSha256": digest_file(tool_root / "uv.lock"),
              "conversionToolFiles": [{"fileName": str(path.relative_to(tool_root)), "byteLength": path.stat().st_size,
                                       "sha256": digest_file(path)} for path in tool_files],
              "licensing": evidence["register"]["licensing"], "graphs": [],
              "validationScope": "FP32 CPU graph parity only; model publication and desktop GPU validation remain pending",
              "environment": {name: importlib.metadata.version(name) for name in
                              ("torch", "torchvision", "onnx", "onnxscript", "onnxruntime", "numpy", "protobuf")}}
    try:
        with tempfile.TemporaryDirectory(prefix="corridorkey-no-bytecode-") as cache, \
                (args.output / "conversion.log").open("w") as log, contextlib.redirect_stdout(log), contextlib.redirect_stderr(log):
            sys.pycache_prefix = cache
            run_conversion(args.source_root.resolve(), args.output.resolve(), args.graph, args.threads, report)
    except BaseException as error:
        report["status"] = "candidate-validation-failed"
        report["failure"] = str(error)
        raise
    finally:
        (args.output / "candidate-report.json").write_text(json.dumps(report, indent=2) + "\n")
    print(f"Candidate CPU validation complete: {args.output / 'candidate-report.json'}", flush=True)


if __name__ == "__main__":
    main()
