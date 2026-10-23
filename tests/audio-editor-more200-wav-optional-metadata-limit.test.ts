/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { encodeWav } from '../src/common/editor/wav.js';
import { inspectWavBlobPcm, streamWavBlobPcm } from '../src/common/editor/wav-import.js';

const samples = Float32Array.of(.25, -.25, .5, -.5);
function recording(id: string, length: number): File {
	const base = Uint8Array.from(encodeWav([samples], { container: 'bw64', sampleRate: 48_000, dither: false,
		bext: { description: 'Independent recorder metadata' }, metadata: { title: 'Retained take' },
		markers: id === 'cue ' ? [] : [{ sampleOffset: 1, label: 'Retained cue' }] }));
	base.set(new TextEncoder().encode('RF64'));
	const header = new Uint8Array(8); header.set(new TextEncoder().encode(id)); new DataView(header.buffer).setUint32(4, length, true);
	new DataView(base.buffer).setBigUint64(20, BigInt(base.length + 8 + length + length % 2 - 8), true);
	new DataView(base.buffer).setBigUint64(36, BigInt(samples.length), true);
	const payload = new Uint8Array(length).fill(32);
	if (id === 'iXML') { payload.set(new TextEncoder().encode('<BWFXML><NOTE>')); payload.set(new TextEncoder().encode('</NOTE></BWFXML>'), payload.length - 16); }
	return new File([base, header, payload, new Uint8Array(length % 2)], 'Recorder.wav', { type: 'audio/wav' });
}

for (const id of ['iXML', 'cue ', 'cart']) test(`oversized optional WAV ${id} cannot reject its independent PCM and markers`, async () => {
	const file = recording(id, 16 * 1024 ** 2 + 1);
	const boundedFile = { size: file.size, slice(start: number, end: number) {
		assert.ok(end - start < 1024 ** 2, 'ignored metadata must never be materialized'); return file.slice(start, end);
	} };
	const descriptor = await inspectWavBlobPcm(boundedFile);
	assert.equal(descriptor.frameCount, samples.length); assert.equal(descriptor.bext.description, 'Independent recorder metadata');
	assert.equal(descriptor.info.title, 'Retained take');
	assert.equal(descriptor.markers[0]?.label, id === 'cue ' ? undefined : 'Retained cue');
	assert.ok(descriptor.metadataWarnings.some((warning: Readonly<{ message: string }>) => /omitted|ignored/iu.test(warning.message)));
	const actual: number[] = [];
	await streamWavBlobPcm(file, { descriptor, onChunk(channels: Float32Array[]) { actual.push(...channels[0]!); } });
	assert.deepEqual(actual, [...samples]);
});

test('the smaller iXML parser budget already omits oversized metadata while importing PCM', async () => {
	const descriptor = await inspectWavBlobPcm(recording('iXML', 4 * 1024 ** 2 + 1));
	assert.equal(descriptor.frameCount, samples.length); assert.equal(descriptor.ixml, null);
	assert.ok(descriptor.metadataWarnings.some((warning: Readonly<{ code: string }>) => warning.code === 'ixml-invalid'));
});
