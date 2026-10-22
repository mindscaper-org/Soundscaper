# SPDX-License-Identifier: AGPL-3.0-only
"""Export-only equivalent attention masks; publisher source remains on disk unchanged.

The restricted upstream implementation is loaded only from an authenticated
operator checkout. No upstream implementation or weights are copied here.
"""
from __future__ import annotations

import inspect
import textwrap

import torch
import torch.nn.functional as functional

PATCH_RECIPE = "corridorkey-v2-dense-region-mask-dynamic-cpe-and-dino-position-v1"


def region_ids(height, width, padded_height, padded_width, window, shift_h, shift_w):
    y = torch.arange(padded_height).view(padded_height, 1)
    x = torch.arange(padded_width).view(1, padded_width)
    rows = ((y >= padded_height - window).to(torch.int64)
            + (y >= padded_height - shift_h).to(torch.int64)) if shift_h else torch.zeros_like(y)
    columns = ((x >= padded_width - window).to(torch.int64)
               + (x >= padded_width - shift_w).to(torch.int64)) if shift_w else torch.zeros_like(x)
    regions = rows * (3 if shift_w else 1) + columns
    regions = torch.where((y < height) & (x < width), regions, torch.full_like(regions, -1))
    regions = torch.roll(regions, shifts=(-shift_h, -shift_w), dims=(0, 1))
    return regions.reshape(padded_height // window, window, padded_width // window, window) \
        .permute(0, 2, 1, 3).reshape(-1, window * window)


def groups_2d(height, width, padded_height, padded_width, window, shift_h, shift_w):
    return (region_ids(height, width, padded_height, padded_width, window, shift_h, shift_w),)


def groups_3d(frames, height, width, padded_height, padded_width, window_h, window_w, shift_h, shift_w):
    regions = region_ids(height, width, padded_height, padded_width, window_h, shift_h, shift_w)
    return (regions.unsqueeze(1).expand(-1, frames, -1).reshape(-1, frames * window_h * window_w),)


def dense_region_attention(q, k, v, regions):
    regions = regions.to(q.device)
    real_query = regions.unsqueeze(2) >= 0
    real_key = regions.unsqueeze(1) >= 0
    allowed = (((regions.unsqueeze(1) == regions.unsqueeze(2)) | ~real_query) & real_key).unsqueeze(1)
    return functional.scaled_dot_product_attention(q, k, v, attn_mask=allowed,
                                                  dropout_p=0., is_causal=False)


def dynamic_cpe(self, batch_size, input_dims):
    """Equivalent evaluation CPE interpolation without aspect-ratio Python guards."""
    del batch_size
    if self.training or not self.cpe_mode:
        raise ValueError("The pinned C-RADIO evaluation CPE configuration is required")
    height, width = input_dims
    size = torch.sym_max(height, width)
    position = self.pos_embed.reshape(1, self.num_rows, self.num_cols, -1).permute(0, 3, 1, 2)
    position = functional.interpolate(position.float(), size=(size, size), mode="bilinear",
                                      align_corners=False).to(position.dtype)
    return position[..., :height, :width].flatten(2).permute(0, 2, 1)


def dynamic_dino_position(self, tokens, height, width):
    """Preserve DINO's offset sampling coordinates using a dynamic bicubic grid."""
    if self.interpolate_antialias:
        raise ValueError("The pinned DINO position interpolation must not use antialiasing")
    position = self.pos_embed.float()
    side = int((position.shape[1] - 1) ** .5)
    rows, columns = height // self.patch_size, width // self.patch_size
    rows_float = torch.scalar_tensor(rows, device=position.device, dtype=torch.float32)
    columns_float = torch.scalar_tensor(columns, device=position.device, dtype=torch.float32)
    original_size = (rows_float == side) & (columns_float == side)
    offset = torch.where(original_size, torch.zeros_like(rows_float),
                         torch.full_like(rows_float, float(self.interpolate_offset)))
    y = (torch.arange(rows, device=position.device, dtype=torch.float32) + .5) * (2. / (rows_float + offset)) - 1.
    x = (torch.arange(columns, device=position.device, dtype=torch.float32) + .5) * (2. / (columns_float + offset)) - 1.
    grid = torch.stack((x.view(1, -1).expand(rows, -1), y.view(-1, 1).expand(-1, columns)), dim=-1).unsqueeze(0)
    patch_position = position[:, 1:].reshape(1, side, side, -1).permute(0, 3, 1, 2)
    patch_position = functional.grid_sample(patch_position, grid, mode="bicubic", padding_mode="border", align_corners=False)
    patch_position = patch_position.flatten(2).permute(0, 2, 1)
    return torch.cat((position[:, :1], patch_position), dim=1).to(tokens.dtype)


def install_attention_patch(blocks, model) -> None:
    original = textwrap.dedent(inspect.getsource(blocks.SwinAttention3D.forward))
    needle = "if region_groups is None:\n            return None\n"
    if original.count(needle) != 1:
        raise ValueError("Pinned Swin attention source does not match the export rewrite")
    rewritten = original.replace(needle, needle + "        if len(region_groups) == 1:\n            return region_groups\n")
    namespace = {}
    exec(compile(rewritten, "<authenticated-corridorkey-export-rewrite>", "exec"), vars(blocks), namespace)
    blocks.SwinAttention3D.forward = namespace["forward"]
    blocks._shifted_region_groups_2d_cached = groups_2d
    blocks._shifted_region_groups_3d_cached = groups_3d
    blocks._sdpa_with_region_groups = dense_region_attention
    for module in model.modules():
        if module.__class__.__name__ == "SwinAttention3D":
            module.inference_window_batch = 10 ** 9


def install_cpe_patch(model) -> None:
    for module in model.modules():
        if module.__class__.__name__ == "ViTPatchGenerator":
            module._get_pos_embeddings = dynamic_cpe.__get__(module, module.__class__)
        elif module.__class__.__name__ == "DinoVisionTransformer":
            module.interpolate_pos_encoding = dynamic_dino_position.__get__(module, module.__class__)
