# SPDX-License-Identifier: AGPL-3.0-only
import unittest
from types import SimpleNamespace

import torch

from framescaper_corridorkey_conversion.export_patches import dense_region_attention, dynamic_dino_position


class DenseRegionAttentionTests(unittest.TestCase):
    def test_regions_are_isolated_and_padding_does_not_change_real_tokens(self):
        q = torch.ones(1, 1, 4, 1)
        k = torch.ones_like(q)
        v = torch.tensor([[[[1.], [3.], [9.], [100.]]]])
        regions = torch.tensor([[0, 0, 1, -1]])
        actual = dense_region_attention(q, k, v, regions)
        torch.testing.assert_close(actual[0, 0, :3, 0], torch.tensor([2., 2., 9.]))
        self.assertTrue(torch.isfinite(actual).all())

    def test_dynamic_position_grid_preserves_offset_bicubic_sampling(self):
        generator = torch.Generator().manual_seed(41)
        position = torch.rand(1, 26, 4, generator=generator)
        model = SimpleNamespace(pos_embed=position, patch_size=14, interpolate_offset=.1,
                                interpolate_antialias=False)
        patch = position[:, 1:].reshape(1, 5, 5, 4).permute(0, 3, 1, 2)
        for rows, columns in ((4, 8), (8, 4), (5, 5)):
            if rows == columns == 5:
                expected = position
            else:
                resized = torch.nn.functional.interpolate(patch,
                    scale_factor=((rows + .1) / 5, (columns + .1) / 5), mode="bicubic")
                expected = torch.cat((position[:, :1], resized.flatten(2).permute(0, 2, 1)), dim=1)
            actual = dynamic_dino_position(model, torch.empty(1, 1, 4), rows * 14, columns * 14)
            torch.testing.assert_close(actual, expected, atol=5e-6, rtol=5e-6)


if __name__ == "__main__":
    unittest.main()
