/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { inflateRawSync } from 'node:zlib';

// Generated with FFmpeg 6.1.1 and libx264. The 64x48 grayscale input labels
// each 30 fps picture with five bits in a 4x2 grid. Drop input frame 27 and
// frames whose index is 1 modulo 5. Encode yuv420p VFR with `-preset veryfast
// -sc_threshold 0 -g 7 -bf 2 -video_track_timescale 90000 -movflags +faststart`.
const ENCODED_AVC = [
	'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',
].join('');

export function classicAvcCaptureMedia() {
	const buffer = inflateRawSync(Buffer.from(ENCODED_AVC, 'base64'));
	assert.equal(createHash('sha256').update(buffer).digest('hex'),
		'29550db3855d8a495465d96b901ef1ba04b5b23272bc91f76969dd715a3d6074');
	return { name: 'classic-vfr-capture.mp4', mimeType: 'video/mp4', buffer };
}
