/* SPDX-License-Identifier: AGPL-3.0-only */

import { encodeAiff } from '../../src/common/editor/aiff.js';

/** Ordinary PCM and optional ANNO chunks, each inside the maintained 4 MiB limit. */
export function aiffWithRepeatedAnnotations(count = 18, annotationBytes = 1024 * 1024): File {
	const encoded = encodeAiff([new Float32Array(4800).fill(.25)], { sampleRate: 48_000, bitDepth: 16, dither: false });
	if (!(encoded instanceof Uint8Array)) throw new TypeError('The fixture requires collected AIFF bytes.');
	const pcm = Uint8Array.from(encoded);
	const name = aiffChunk('NAME', new TextEncoder().encode('Retained title'));
	const annotation = aiffChunk('ANNO', new Uint8Array(annotationBytes).fill(65));
	const header = pcm.slice(0, 12);
	new DataView(header.buffer).setUint32(4, pcm.length - 8 + name.size + count * annotation.size);
	return new File([header, name, ...Array.from({ length: count }, () => annotation), pcm.slice(12)],
		'Optional metadata.aiff', { type: 'audio/aiff' });
}

function aiffChunk(id: string, payload: Uint8Array<ArrayBuffer>): Blob {
	const header = new Uint8Array(8);
	for (const [index, character] of [...id].entries()) header[index] = character.charCodeAt(0);
	new DataView(header.buffer).setUint32(4, payload.length);
	return new Blob([header, payload, new Uint8Array(payload.length % 2)]);
}
