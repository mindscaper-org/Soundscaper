/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';

/** Genuine ten-minute stereo recording, compressed only to keep the fixture small.
 * Produced with the lockfile-pinned @ffmpeg/core 0.12.10:
 * -f lavfi -i anullsrc=r=48000:cl=stereo -t 600 -c:a aac -b:a 32k -movflags +faststart podcast.m4a
 */
export function freesoundLongM4aFixture(): Uint8Array<ArrayBuffer> {
	const compressed = readFileSync(new URL('../fixtures/ffmpeg-aac-lc-600s-silence.m4a.gz.base64', import.meta.url), 'utf8').trim();
	const bytes = gunzipSync(Buffer.from(compressed, 'base64'));
	assert.equal(bytes.length, 283_929);
	assert.equal(createHash('sha256').update(bytes).digest('hex'), '297af9f14546a5361ec0ba9ef06d53575f792bbaa00ac4b846e024f70cb6a358');
	return Uint8Array.from(bytes);
}
