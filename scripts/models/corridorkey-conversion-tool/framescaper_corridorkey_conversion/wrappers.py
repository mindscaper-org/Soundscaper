# SPDX-License-Identifier: AGPL-3.0-only
"""Five FP32 graph boundaries around the authenticated publisher implementation."""
from __future__ import annotations

import os
import sys
from pathlib import Path

import torch

GRAPH_ROLES = ("cradio", "moge", "rvm", "stage1", "stage2")


def load_publisher_model(root: Path):
    os.environ["HF_HUB_OFFLINE"] = "1"
    os.environ["TRANSFORMERS_OFFLINE"] = "1"
    os.environ["HF_HUB_DISABLE_TELEMETRY"] = "1"
    sys.path.insert(0, str(root))
    sys.path.insert(0, str(root / "third_party/MoGe"))
    from corridorkey.runtime import RuntimePaths, load_model
    return load_model(RuntimePaths.from_package(root), device="cpu").eval()


class CradioGraph(torch.nn.Module):
    def __init__(self, foundations):
        super().__init__()
        self.core = foundations.cradio
        self.register_buffer("mean", foundations.cradio_mean.reshape(1, -1, 1, 1))
        self.register_buffer("std", foundations.cradio_std.clamp(min=1e-6).reshape(1, -1, 1, 1))

    def forward(self, rgb):
        output = self.core(rgb).features
        output = output.transpose(1, 2).reshape(1, 1152, rgb.shape[-2] // 16, rgb.shape[-1] // 16)
        return (output.float() - self.mean) / self.std


class MogeGraph(torch.nn.Module):
    def __init__(self, foundations):
        super().__init__()
        self.core = foundations.moge.encoder
        self.register_buffer("mean", foundations.moge_mean.reshape(1, -1, 1, 1))
        self.register_buffer("std", foundations.moge_std.clamp(min=1e-6).reshape(1, -1, 1, 1))

    def forward(self, rgb):
        output, _ = self.core(rgb, rgb.shape[-2] // 14, rgb.shape[-1] // 14, return_class_token=True)
        return (output.float() - self.mean) / self.std


class RvmGraph(torch.nn.Module):
    def __init__(self, foundations):
        super().__init__()
        self.core = foundations.rvm
        self.register_buffer("mean", foundations.rvm_mean.reshape(1, 1, -1, 1, 1))
        self.register_buffer("std", foundations.rvm_std.clamp(min=1e-6).reshape(1, 1, -1, 1, 1))

    def forward(self, rgb, state):
        features, state_out = self.core(rgb, state)
        return (features.float() - self.mean) / self.std, state_out


class Stage1Graph(torch.nn.Module):
    def __init__(self, model):
        super().__init__()
        self.core = model.stage1

    def forward(self, rgb, hint, moge, cradio, rvm, quality):
        output = self.core(rgb, hint, moge, cradio_feat=cradio, rvm_feat=rvm, hint_quality=quality)
        return output["baton"], output["aux"]


class Stage2Graph(torch.nn.Module):
    def __init__(self, model):
        super().__init__()
        self.core = model.stage2

    def forward(self, rgb, baton):
        return self.core(rgb, baton)


def create_graph(role: str, model):
    if role == "cradio":
        return CradioGraph(model.foundations).eval(), ["rgb"], ["features"]
    if role == "moge":
        return MogeGraph(model.foundations).eval(), ["rgb"], ["features"]
    if role == "rvm":
        return RvmGraph(model.foundations).eval(), ["rgb", "state"], ["features", "state_out"]
    if role == "stage1":
        return Stage1Graph(model).eval(), ["rgb", "hint", "moge", "cradio", "rvm", "quality"], ["baton", "aux"]
    if role == "stage2":
        return Stage2Graph(model).eval(), ["rgb", "baton"], ["logits"]
    raise ValueError(f"Unknown graph role: {role}")


def example_arguments(role: str, height: int, width: int):
    generator = torch.Generator().manual_seed(height * 10000 + width)
    def sample(*shape):
        return torch.rand(shape, generator=generator, dtype=torch.float32)
    if role == "cradio":
        return (sample(1, 3, height // 4, width // 4),)
    if role == "moge":
        return (sample(1, 3, height * 7 // 32, width * 7 // 32),)
    if role == "rvm":
        return (sample(1, 1, 3, height // 4, width // 4),
                torch.zeros(1, 1 + height * width // 4096, 384))
    from corridorkey.color_utils import linear_to_asinh, srgb_to_linear
    rgb = linear_to_asinh(srgb_to_linear(sample(1, 1, 3, height, width)))
    if role == "stage2":
        return rgb, sample(1, 1, 512, height // 16, width // 16)
    return (rgb, torch.zeros(1, 1, 1, height, width),
            sample(1, 1, 768, height // 64, width // 64),
            sample(1, 1, 1152, height // 64, width // 64),
            sample(1, 1, 384, height // 64, width // 64), torch.full((1, 1), -1.))


def dynamic_shapes(role: str):
    height = torch.export.Dim("raster_h_256", min=1, max=32)
    width = torch.export.Dim("raster_w_256", min=1, max=32)
    if role == "cradio":
        return ({2: 64 * height, 3: 64 * width},)
    if role == "moge":
        return ({2: 56 * height, 3: 56 * width},)
    if role == "rvm":
        return ({3: 64 * height, 4: 64 * width}, {1: torch.export.Dim.AUTO})
    rgb = {3: 256 * height, 4: 256 * width}
    if role == "stage2":
        return rgb, {3: 16 * height, 4: 16 * width}
    feature = {3: 4 * height, 4: 4 * width}
    return rgb, rgb.copy(), feature, feature.copy(), feature.copy(), {}
