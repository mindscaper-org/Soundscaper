# SPDX-License-Identifier: AGPL-3.0-only
"""Export and compare real pinned weights; every emitted artifact remains a candidate."""
from __future__ import annotations

import gc
import json
from pathlib import Path

import numpy as np
import onnxruntime
import torch

from .artifacts import embed_graph, verify_embedded_graph
from .export_patches import PATCH_RECIPE, install_attention_patch, install_cpe_patch
from .inputs import digest_file
from .wrappers import GRAPH_ROLES, create_graph, dynamic_shapes, example_arguments, load_publisher_model

VALIDATION_RASTERS = ((256, 256), (256, 512), (512, 256))


def as_tuple(value):
    return value if isinstance(value, tuple) else (value,)


def compare(expected, actual) -> dict:
    expected = expected.detach().cpu().numpy()
    if not np.isfinite(actual).all():
        raise ValueError("Exported graph returned non-finite data")
    np.testing.assert_allclose(actual, expected, rtol=2e-3, atol=1e-4)
    difference = actual.astype(np.float64) - expected.astype(np.float64)
    return {"shape": list(actual.shape), "maximumAbsoluteError": float(np.max(np.abs(difference))),
            "rootMeanSquaredError": float(np.sqrt(np.mean(difference ** 2)))}


def graph_artifacts(output: Path, role: str) -> list[dict]:
    path = output / (role + ".onnx")
    return [{"fileName": path.name, "byteLength": path.stat().st_size, "sha256": digest_file(path)}]


def session(path: Path, threads: int):
    options = onnxruntime.SessionOptions()
    options.intra_op_num_threads = threads
    options.inter_op_num_threads = 1
    return onnxruntime.InferenceSession(str(path), sess_options=options, providers=["CPUExecutionProvider"])


def run_conversion(source: Path, output: Path, roles, threads: int, report: dict) -> None:
    model = load_publisher_model(source)
    selected = [role for role in GRAPH_ROLES if roles is None or role in roles]
    baselines = {}
    with torch.inference_mode():
        for role in selected:
            graph, _, _ = create_graph(role, model)
            baselines[role] = [tuple(value.detach().clone() for value in as_tuple(
                graph(*example_arguments(role, height, width)))) for height, width in VALIDATION_RASTERS]
        import corridorkey.blocks as blocks
        install_attention_patch(blocks, model)
        install_cpe_patch(model)
        report["exportRecipe"] = PATCH_RECIPE
        report["rasterPaddingQuantum"] = 256
        report["stage1Frames"] = 1
        report["rvmState"] = "Recurrent across frames; zero initial state; preserve state_out between consecutive frames"
        for role in selected:
            print(f"Exporting authenticated {role} weights", flush=True)
            graph, inputs, outputs = create_graph(role, model)
            for index, (height, width) in enumerate(VALIDATION_RASTERS):
                for expected, actual in zip(baselines[role][index], as_tuple(graph(*example_arguments(role, height, width)))):
                    compare(expected, actual.detach().numpy())
            path = output / (role + ".onnx")
            torch.onnx.export(graph, example_arguments(role, 512, 512), str(path), dynamo=True,
                              opset_version=18, input_names=inputs, output_names=outputs,
                              dynamic_shapes=dynamic_shapes(role), external_data=False,
                              report=True, artifacts_dir=str(output))
            embed_graph(path)
            verify_embedded_graph(path)
            stale_sidecar = output / (role + ".onnx.data")
            if stale_sidecar.is_file():
                stale_sidecar.unlink()
            runtime = session(path, threads)
            validation = []
            for index, (height, width) in enumerate(VALIDATION_RASTERS):
                arguments = example_arguments(role, height, width)
                actual = runtime.run(None, {name: value.numpy() for name, value in zip(inputs, arguments)})
                validation.append({"height": height, "width": width, "outputs": {
                    name: compare(expected, observed) for name, expected, observed in
                    zip(outputs, baselines[role][index], actual)}})
                if role == "rvm":
                    source_second = as_tuple(graph(arguments[0], baselines[role][index][1]))
                    exported_second = runtime.run(None, {"rgb": arguments[0].numpy(), "state": actual[1]})
                    validation[-1]["continuingState"] = {name: compare(expected, observed)
                        for name, expected, observed in zip(outputs, source_second, exported_second)}
            report["graphs"].append({"role": role, "status": "candidate-cpu-parity-passed",
                                     "storage": "embedded-single-blob",
                                     "inputs": inputs, "outputs": outputs, "artifacts": graph_artifacts(output, role),
                                     "cpuParity": validation})
            (output / "candidate-report.json").write_text(json.dumps(report, indent=2) + "\n")
            del runtime, graph
            gc.collect()
    report["allFiveGraphsValidated"] = len(report["graphs"]) == len(GRAPH_ROLES)
