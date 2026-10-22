# SPDX-License-Identifier: AGPL-3.0-only
"""Each graph is a single authenticated blob with no relative tensor files."""
import tempfile
from pathlib import Path

import onnx


def embed_graph(path: Path) -> None:
    """PyTorch may choose sidecars despite external_data=False above its size threshold."""
    model = onnx.load_model(str(path), load_external_data=True)
    onnx.external_data_helper.convert_model_from_external_data(model)
    if model.ByteSize() >= 2 ** 31:
        raise ValueError("A candidate graph exceeds the single-blob protobuf limit")
    with tempfile.TemporaryDirectory(prefix="corridorkey-embed-", dir=path.parent) as directory:
        temporary = Path(directory) / path.name
        onnx.save_model(model, str(temporary), save_as_external_data=False)
        temporary.replace(path)


def verify_embedded_graph(path: Path) -> None:
    if path.stat().st_size >= 2 ** 31:
        raise ValueError("A candidate graph exceeds the single-blob protobuf limit")
    model = onnx.load_model(str(path), load_external_data=False)
    def visit(message):
        if isinstance(message, onnx.TensorProto):
            if message.data_location == onnx.TensorProto.EXTERNAL or message.external_data:
                raise ValueError("External tensor data cannot resolve from content-addressed model storage")
            return
        for field, value in message.ListFields():
            if field.type == field.TYPE_MESSAGE:
                for child in value if field.label == field.LABEL_REPEATED else (value,):
                    visit(child)
    visit(model)
