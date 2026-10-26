# SPDX-License-Identifier: AGPL-3.0-only
"""Remove non-executable exporter metadata and prove byte-exact ORT outputs."""
from __future__ import annotations

import argparse
import gc
import hashlib
import json
import tempfile
from pathlib import Path

import onnx
import onnxruntime


def file_pin(path: Path) -> dict:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(4 * 1024 * 1024), b""):
            digest.update(chunk)
    return {"fileName": path.name, "byteLength": path.stat().st_size, "sha256": digest.hexdigest()}


def strip_metadata(message) -> None:
    for name in ("metadata_props", "doc_string"):
        if name in message.DESCRIPTOR.fields_by_name:
            message.ClearField(name)
    for field, value in message.ListFields():
        if field.type == field.TYPE_MESSAGE:
            for child in value if field.label == field.LABEL_REPEATED else (value,):
                strip_metadata(child)


def session(path: Path):
    options = onnxruntime.SessionOptions()
    options.intra_op_num_threads = 1
    options.inter_op_num_threads = 1
    return onnxruntime.InferenceSession(str(path), sess_options=options, providers=["CPUExecutionProvider"])


def canonicalize_graph(path: Path, feeds_cases: list[dict]) -> dict:
    original = file_pin(path)
    runtime = session(path)
    expected = [runtime.run(None, feeds) for feeds in feeds_cases]
    del runtime
    gc.collect()
    model = onnx.load_model(str(path), load_external_data=False)
    strip_metadata(model)
    if model.ByteSize() >= 2 ** 31:
        raise ValueError("The canonical graph exceeds the standalone protobuf limit")
    with tempfile.TemporaryDirectory(prefix="canonical-", dir=path.parent) as directory:
        output = Path(directory) / path.name
        onnx.save_model(model, str(output), save_as_external_data=False)
        del model
        gc.collect()
        runtime = session(output)
        for feeds, reference in zip(feeds_cases, expected):
            actual = runtime.run(None, feeds)
            if len(actual) != len(reference):
                raise ValueError("Canonicalization changed the output inventory")
            for before, after in zip(reference, actual):
                if before.dtype != after.dtype or before.shape != after.shape or before.tobytes() != after.tobytes():
                    raise ValueError("Canonicalization changed numerical output bytes")
        del runtime
        output.replace(path)
    gc.collect()
    return {"original": original, "canonical": file_pin(path), "outputComparison": "byte-exact",
            "rasterCases": len(feeds_cases)}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--model-root", type=Path, required=True)
    parser.add_argument("--source-root", type=Path, required=True)
    args = parser.parse_args()
    import sys
    sys.path.insert(0, str(args.source_root.resolve()))
    from framescaper_corridorkey_conversion.wrappers import example_arguments
    report_path = args.model_root / "candidate-report.json"
    report = json.loads(report_path.read_text())
    if report.get("allFiveGraphsValidated") is not True or [row["role"] for row in report["graphs"]] != ["cradio", "moge", "rvm", "stage1", "stage2"]:
        raise ValueError("Canonicalization requires the complete measured five-graph export")
    reviewed = []
    for graph in report["graphs"]:
        role = graph["role"]
        path = args.model_root / (role + ".onnx")
        if graph["artifacts"] != [file_pin(path)]:
            raise ValueError("The source graph differs from its conversion measurement")
        feeds = [dict(zip(graph["inputs"], (value.numpy() for value in example_arguments(role, height, width))))
                 for height, width in ((256, 256), (256, 512), (512, 256))]
        result = canonicalize_graph(path, feeds)
        graph["artifacts"] = [result["canonical"]]
        reviewed.append({"role": role, **result})
        print(f"Canonical {role}: all three rasters preserve exact output bytes", flush=True)
    report["canonicalization"] = {"recipe": "remove-onnx-debug-metadata-v1", "script": file_pin(Path(__file__)), "graphs": reviewed}
    report_path.write_text(json.dumps(report, indent=2) + "\n")


if __name__ == "__main__":
    main()
