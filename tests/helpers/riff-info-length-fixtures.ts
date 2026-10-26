/* SPDX-License-Identifier: AGPL-3.0-only */
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';

// Untouched FFmpeg 5.1.4 / @ffmpeg/core 0.12.10 WAV output: 4800 mono
// 48 kHz s16 frames; -metadata artist="Small independent credit" and
// -metadata comment=<100 or 200000 ASCII x characters>, -c:a pcm_s16le.
// Gzip only compresses the frozen fixture; no header or payload is rewritten.
export function riffInfoLengthFixture(long: boolean): Uint8Array<ArrayBuffer> {
	const name = long ? 'long' : 'short';
	return new Uint8Array(gunzipSync(Buffer.from(readFileSync(new URL(`../fixtures/ffmpeg-${name}-info.wav.gz.base64`, import.meta.url), 'utf8').trim(), 'base64')));
}
