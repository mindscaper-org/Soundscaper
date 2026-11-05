/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createAdmChna, createRiffChnaChunk, generateAdmAxml, parseAdmAxml } from '../src/common/editor/adm-metadata.ts';
import { validateAdmSxmlPayload } from '../src/common/editor/adm-sxml.ts';
import { encodeWav } from '../src/common/editor/wav.js';
import { inspectWavBlobPcm } from '../src/common/editor/wav-import.js';

function chunk(id: string, bytes: Uint8Array): Uint8Array<ArrayBuffer> {
	const output = new Uint8Array(8 + bytes.length + bytes.length % 2);
	output.set(new TextEncoder().encode(id));
	new DataView(output.buffer).setUint32(4, bytes.length, true);
	output.set(bytes, 8);
	return output;
}

function serialXml(xml: string): Uint8Array<ArrayBuffer> {
	const bytes = new TextEncoder().encode(xml);
	const output = new Uint8Array(26 + bytes.length);
	const view = new DataView(output.buffer);
	view.setUint32(2, 12 + bytes.length, true);
	view.setUint32(10, 1, true);
	view.setUint32(14, bytes.length, true);
	view.setUint32(18, 4800, true);
	output.set(bytes, 22);
	return output;
}

for (const inert of ['', '<!-- Transcript quotes <!DOCTYPE html>, <!ENTITY example> and <?vendor run="yes"?> -->',
	'<vendor><![CDATA[<!DOCTYPE html> <!ENTITY example> <?vendor run="yes"?>]]></vendor>']) {
	test(`valid ADM WAVE retains inert XML transcript text ${inert.slice(0, 12)}`, async () => {
		const xml = generateAdmAxml({ layout: 'stereo' }).replace('  <coreMetadata>', `${inert}\n  <coreMetadata>`);
		const encoded = encodeWav([new Float32Array(4800), new Float32Array(4800)], { sampleRate: 48_000, bitDepth: 16, dither: false,
			preDataChunks: [chunk('axml', new TextEncoder().encode(xml)), createRiffChnaChunk(createAdmChna({ layout: 'stereo' }))] });
		assert.ok(encoded instanceof Uint8Array);
		const descriptor = await inspectWavBlobPcm(new File([Uint8Array.from(encoded)], 'Lecture.wav', { type: 'audio/wav' }));
		assert.equal(descriptor.frameCount, 4800);
		assert.equal(descriptor.adm?.valid, true);
		assert.deepEqual(descriptor.metadataWarnings, []);
		assert.equal(validateAdmSxmlPayload(serialXml(`<frame>${inert}</frame>`)).totalSamples, 4800n);
	});
}

test('ADM XML still rejects actual declarations, processing instructions and entity expansion', () => {
	for (const xml of ['<!DOCTYPE frame><frame/>', '<!DOCTYPE frame SYSTEM "https://example.invalid/adm.dtd"><frame/>',
		'<!DOCTYPE frame [<!ENTITY secret "hidden">]><frame>&secret;</frame>', '<?vendor run="yes"?><frame/>', '<frame>&unknown;</frame>']) {
		assert.throws(() => parseAdmAxml(xml));
		assert.throws(() => validateAdmSxmlPayload(serialXml(xml)));
	}
});
