# SPDX-License-Identifier: AGPL-3.0-only
import tempfile
import unittest
from pathlib import Path

import numpy as np
import onnx

from framescaper_corridorkey_conversion.artifacts import embed_graph, verify_embedded_graph


class EmbeddedGraphTests(unittest.TestCase):
    def test_materializes_exporter_sidecars_without_changing_weights(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "model.onnx"
            tensor = onnx.numpy_helper.from_array(np.array([1., 3.], dtype=np.float32), name="weight")
            graph = onnx.helper.make_graph([], "fixture", [], [], initializer=[tensor])
            onnx.save_model(onnx.helper.make_model(graph), str(path), save_as_external_data=True,
                            all_tensors_to_one_file=True, location="weights.bin", size_threshold=0)
            with self.assertRaisesRegex(ValueError, "External tensor"):
                verify_embedded_graph(path)
            embed_graph(path)
            verify_embedded_graph(path)
            (Path(directory) / "weights.bin").unlink()
            actual = onnx.load_model(path).graph.initializer[0]
            np.testing.assert_array_equal(onnx.numpy_helper.to_array(actual), np.array([1., 3.], dtype=np.float32))

    def test_checks_embedded_weights_and_nested_constant_tensors(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "model.onnx"
            tensor = onnx.numpy_helper.from_array(np.ones(2, dtype=np.float32), name="weight")
            graph = onnx.helper.make_graph([], "fixture", [], [], initializer=[tensor])
            model = onnx.helper.make_model(graph)
            path.write_bytes(model.SerializeToString())
            verify_embedded_graph(path)
            model.graph.initializer[0].data_location = onnx.TensorProto.EXTERNAL
            path.write_bytes(model.SerializeToString())
            with self.assertRaisesRegex(ValueError, "External tensor"):
                verify_embedded_graph(path)
            graph = onnx.helper.make_graph([onnx.helper.make_node("Constant", [], ["x"], value=tensor)], "constant", [], [])
            model = onnx.helper.make_model(graph)
            model.graph.node[0].attribute[0].t.data_location = onnx.TensorProto.EXTERNAL
            path.write_bytes(model.SerializeToString())
            with self.assertRaisesRegex(ValueError, "External tensor"):
                verify_embedded_graph(path)


if __name__ == "__main__":
    unittest.main()
