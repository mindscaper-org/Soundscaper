/* SPDX-License-Identifier: AGPL-3.0-only */

import { encodeWav } from '../../src/common/editor/wav.js';
import { createRiffBextChunk } from '../../src/common/editor/broadcast-wave.ts';
import { createRiffInfoChunk } from '../../src/common/editor/riff-info.ts';

/** FFmpeg's nonseekable WAV muxer leaves both RIFF and terminal data lengths at -1.
 * wavenc.c wav_write_header/wav_write_trailer and riffenc.c ff_start_tag:
 * https://github.com/FFmpeg/FFmpeg/blob/master/libavformat/wavenc.c
 */
export function pipedWavFixture(samples = Float32Array.of(.25, -.25, .5, -.5)): Uint8Array<ArrayBuffer> {
	const encoded = Uint8Array.from(encodeWav([samples], { sampleRate: 48_000, bitDepth: 16, dither: false }));
	const chunks = [encoded.subarray(0, 36),
		createRiffBextChunk({ description: 'Pipe microphone take', originator: 'Field recorder' }),
		createRiffInfoChunk({ title: 'Piped title', artist: 'Alice' }), encoded.subarray(36)];
	const bytes = new Uint8Array(chunks.reduce((total, chunk) => total + chunk.length, 0));
	let offset = 0;
	for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
	const view = new DataView(bytes.buffer);
	view.setUint32(4, 0xffff_ffff, true);
	view.setUint32(bytes.length - samples.length * 2 - 4, 0xffff_ffff, true);
	return bytes;
}
