/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

// Untouched pinned @ffmpeg/core FFmpeg5.1.4 MP4 outputs: RGBblue64x32/25fps/3s,
// libx264 baseline/yuv420p plus two mono AAC96k/48k programmes at440Hz/880Hz.
// First is2s at0; second is default, at0/.5s and2s/5s long respectively.
// Independent FFmpeg first-track decode is byte-identical across all three:
// e69f8885630b30f691de09d8b0305a48a559f3ddc622009b9d8631afcf46bd17.
// Its96256 samples include256 AAC tail padding beyond the authored2s extent.
const HASHES = {
	aligned: 'e9b44ee50fc437a22151a68a2367787469700442885fd190df46ff697df8b38b',
	'delayed-default': 'c16b81673dfed3b85cebf9e09b3a08bd80f8cae14c3b8c9d28a47f3aed86d7a2',
	'long-primary': '632eb5c871b14d33d380f173b15ccd2df7b0f925b8b7b70d1759eeddccdaddda',
} as const;
export function multipleAudioOriginFixture(variant: keyof typeof HASHES): Buffer<ArrayBuffer> {
	const bytes = Buffer.from(readFileSync(new URL(`./multiple-audio-${variant}.mp4.base64`, import.meta.url), 'utf8'), 'base64');
	assert.equal(createHash('sha256').update(bytes).digest('hex'), HASHES[variant]);
	return bytes;
}
