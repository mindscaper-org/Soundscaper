# SPDX-License-Identifier: AGPL-3.0-only
"""Optional source-PyTorch reference for the authenticated production CPU diagnostic."""
from __future__ import annotations

import base64
import contextlib
import importlib.metadata
import json
import sys
from pathlib import Path

sys.dont_write_bytecode = True
source_root = Path(sys.argv[1]).resolve()
register_path = Path(sys.argv[2]).resolve()
tool_root = Path(__file__).resolve().parent / "corridorkey-conversion-tool"
sys.path.insert(0, str(tool_root))
from framescaper_corridorkey_conversion.inputs import verify_inputs

# This authenticates the clean publisher Git tree, all weights, notices and the
# complete C-RADIO remote-code inventory before any publisher code is imported.
evidence = verify_inputs(source_root, register_path)
with contextlib.redirect_stdout(sys.stderr):
    import numpy as np
    import torch
    import torch.nn.functional as functional
    from framescaper_corridorkey_conversion.wrappers import create_graph, load_publisher_model

    torch.set_num_threads(4)
    model = load_publisher_model(source_root)
    graphs = {name: create_graph(name, model)[0] for name in ("cradio", "moge", "rvm", "stage1", "stage2")}
    from corridorkey.color_utils import asinh_to_linear, linear_to_asinh, linear_to_srgb, srgb_to_linear

print(json.dumps({"sourceRevision": evidence["register"]["source"]["revision"],
                  "trackedSourceFiles": evidence["trackedSourceFiles"],
                  "environment": {name: importlib.metadata.version(name) for name in ("torch", "numpy")}}), flush=True)
state = None
sequence = 0
for line in sys.stdin:
    request = json.loads(line)
    ordinal = sequence % 2
    mode = ("none", "chroma-key")[min(sequence // 2, 1)]
    if request.get("ordinal") != ordinal or request.get("hintMode") != mode or sequence > 3:
        raise ValueError("The diagnostic requires two ordered frames per hint mode")
    if ordinal == 0:
        state = None
    rgba = np.frombuffer(base64.b64decode(request["rgba"], validate=True), dtype=np.uint8)
    if rgba.size != 256 * 256 * 4:
        raise ValueError("The diagnostic reference geometry must be 256 by 256 RGBA8")
    rgba = rgba.reshape(256, 256, 4)
    display = torch.tensor(rgba[:, :, :3].transpose(2, 0, 1).copy()).float().unsqueeze(0) / 255
    with torch.inference_mode(), contextlib.redirect_stdout(sys.stderr):
        rgb = linear_to_asinh(srgb_to_linear(display)).unsqueeze(1)
        radio_rgb = functional.interpolate(display, size=(64, 64), mode="area")
        moge_rgb = functional.interpolate(display, size=(56, 56), mode="area")
        rvm_rgb = functional.interpolate(display, size=(64, 64), mode="bilinear", align_corners=False).unsqueeze(1)
        if state is None:
            state = torch.zeros(1, 17, 384)
        radio = graphs["cradio"](radio_rgb).unsqueeze(1)
        moge = graphs["moge"](moge_rgb).unsqueeze(1)
        rvm, state = graphs["rvm"](rvm_rgb, state)
        hint = torch.zeros(1, 1, 1, 256, 256)
        quality = -1.
        if mode == "chroma-key":
            matte = np.frombuffer(base64.b64decode(request["hint"], validate=True), dtype="<f4").copy()
            if matte.size != 256 * 256 or not np.isfinite(matte).all() or matte.min() < 0 or matte.max() > 1:
                raise ValueError("The diagnostic requires an exact finite normalized hint")
            hint = torch.from_numpy(matte).reshape(1, 1, 1, 256, 256)
            quality = 0.75
        baton, _ = graphs["stage1"](rgb, hint, moge, radio, rvm, torch.full((1, 1), quality))
        logits = graphs["stage2"](rgb, baton).squeeze(0).squeeze(0)
        foreground = linear_to_srgb(asinh_to_linear(logits[1:])).clamp(0, 1)
        output = torch.cat((foreground, logits[0:1].clamp(0, 1))).permute(1, 2, 0).mul(255).round().to(torch.uint8).numpy()
    print(json.dumps({"ordinal": ordinal, "rgba": base64.b64encode(output.tobytes()).decode()}), flush=True)
    sequence += 1
if sequence != 4:
    raise ValueError("The diagnostic ended before both recurrent frames in both hint modes")
