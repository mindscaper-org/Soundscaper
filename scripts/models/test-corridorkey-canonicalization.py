# SPDX-License-Identifier: AGPL-3.0-only
import importlib.util
import tempfile
import unittest
from pathlib import Path

import numpy as np
import onnx
from onnx import TensorProto, helper, numpy_helper

spec = importlib.util.spec_from_file_location("canonicalizer", Path(__file__).with_name("canonicalize-corridorkey-assets.py"))
canonicalizer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(canonicalizer)


class CanonicalizationTest(unittest.TestCase):
    def test_debug_paths_cannot_change_canonical_weights_shapes_or_outputs(self):
        with tempfile.TemporaryDirectory() as directory:
            paths = []
            for name in ("first", "second"):
                graph = helper.make_graph([helper.make_node("Add", ["x", "weight"], ["y"])], "fixture",
                    [helper.make_tensor_value_info("x", TensorProto.FLOAT, [1, 2])],
                    [helper.make_tensor_value_info("y", TensorProto.FLOAT, [1, 2])],
                    [numpy_helper.from_array(np.array([[1, -2]], dtype=np.float32), "weight")])
                model = helper.make_model(graph, opset_imports=[helper.make_opsetid("", 18)], ir_version=10)
                model.doc_string = f"/different/{name}/source.py"
                helper.set_model_props(model, {"debug": name})
                model.graph.node[0].metadata_props.add(key="pkg.torch.onnx.stack_trace", value=name)
                path = Path(directory) / (name + ".onnx")
                onnx.save(model, path)
                canonicalizer.canonicalize_graph(path, [{"x": np.array([[3, 4]], dtype=np.float32)}])
                paths.append(path)
            self.assertEqual(paths[0].read_bytes(), paths[1].read_bytes())
            retained = onnx.load(paths[0])
            self.assertEqual(list(retained.graph.input[0].type.tensor_type.shape.dim)[1].dim_value, 2)
            np.testing.assert_array_equal(numpy_helper.to_array(retained.graph.initializer[0]), [[1, -2]])


if __name__ == "__main__":
    unittest.main()
