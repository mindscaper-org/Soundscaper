/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { encodeAiff } from '../src/common/editor/aiff.js';
import { createId3Artwork } from '../src/common/editor/id3-artwork.ts';
import { createAudioEditorController, createMemoryEngine, createTwoTrackFixture, ENGLISH_COPY, storedSample } from './helpers/audio-editor-multitrack-selection-harness.js';
import { normalizeSourceProvenance } from '../src/common/editor/source-provenance.ts';

/** A legal PNG tEXt chunk changes file size without changing the one-pixel image. */
function artworkPng(): Uint8Array<ArrayBuffer> {
	const image = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6hxoAAAAASUVORK5CYII=', 'base64'));
	const body = new Uint8Array(2300 * 1024).fill(88); body.set(new TextEncoder().encode('Comment\0'));
	const extra = new Uint8Array(body.length + 12); const view = new DataView(extra.buffer);
	view.setUint32(0, body.length); extra.set(new TextEncoder().encode('tEXt'), 4); extra.set(body, 8);
	let crc = 0xffff_ffff;
	for (const byte of extra.subarray(4, -4)) {
		crc ^= byte;
		for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb8_8320 : 0);
	}
	view.setUint32(extra.length - 4, (crc ^ 0xffff_ffff) >>> 0);
	const output = new Uint8Array(image.length + extra.length);
	output.set(image.subarray(0, -12)); output.set(extra, image.length - 12); output.set(image.subarray(-12), output.length - 12);
	return output;
}

test('File Import retains AIFF text beside multiple artwork images admitted by the editor', async () => {
	const png = artworkPng();
	const first = await createId3Artwork(new File([png], 'Front.png'));
	const second = { ...await createId3Artwork(new File([png], 'Back.png')), pictureType: 4 };
	const aiff = encodeAiff([new Float32Array(4800).fill(.25)], { sampleRate: 48_000, sampleFormat: 'float32',
		metadata: { title: 'Artwork recording', artist: 'Recordist', id3Artwork: JSON.stringify([first, second]) } });
	assert.ok(aiff.byteLength > 4 * 1024 ** 2);
	const { store } = await createTwoTrackFixture('next-aiff-cover-budget', new Map<string, Float32Array>(), 48_000);
	type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;
	const controller = createAudioEditorController(null, { headless: true, copy: ENGLISH_COPY, locale: 'en', store,
		engine: createMemoryEngine() as unknown as Options['engine'] });
	try {
		await controller.ready;
		await controller.actions.project.importFiles([new File([aiff], 'Art.aiff', { type: 'audio/aiff' })], { destination: 'timeline' });
		const project = controller.getSnapshot().project; assert.ok(project && Array.isArray(project.sources));
		const sources: readonly unknown[] = project.sources; assert.equal(sources.length, 1);
		const source = sources[0]; assert.ok(source && typeof source === 'object' && 'id' in source && typeof source.id === 'string' && 'provenance' in source);
		assert.equal(await storedSample(store, source.id, 0), .25);
		const origin = normalizeSourceProvenance(source.provenance, 'AIFF import').contributions[0]; assert.ok(origin);
		assert.deepEqual(origin.metadata.normalized, { artist: 'Recordist', title: 'Artwork recording' });
		assert.ok(!origin.warnings.some(warning => warning.includes('AIFF ID3 metadata chunk exceeded')));
	} finally { await controller.dispose(); }
});
