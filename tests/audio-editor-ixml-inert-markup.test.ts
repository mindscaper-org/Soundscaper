/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { encodeWav } from '../src/common/editor/wav.js';
import { inspectWavBlobPcm } from '../src/common/editor/wav-import.js';
import { encodeIxmlPayload, parseIxmlPayload } from '../src/common/editor/ixml.ts';

for (const [kind, content, note] of [
	['comment', '<!-- Transcript mentions <!DOCTYPE html> --> <NOTE>XML lecture</NOTE>', 'XML lecture'],
	['CDATA', '<NOTE><![CDATA[Read <!DOCTYPE html> and <!ENTITY example> aloud]]></NOTE>', 'Read <!DOCTYPE html> and <!ENTITY example> aloud'],
] as const) test(`normal WAVE import preserves inert iXML ${kind} declaration text`, async () => {
	const xml = `<?xml version="1.0" encoding="UTF-8"?><BWFXML><IXML_VERSION>1.5</IXML_VERSION><PROJECT>Field recording</PROJECT>${content}</BWFXML>`;
	const payload = new TextEncoder().encode(xml);
	const chunk = new Uint8Array(8 + payload.length + payload.length % 2);
	chunk.set(new TextEncoder().encode('iXML'));
	new DataView(chunk.buffer).setUint32(4, payload.length, true);
	chunk.set(payload, 8);
	const bytes = encodeWav([new Float32Array(4800)], { sampleRate: 48_000, bitDepth: 16, dither: false, preDataChunks: [chunk] });
	const descriptor = await inspectWavBlobPcm(new File([Uint8Array.from(bytes)], 'Lecture.wav', { type: 'audio/wav' }));
	assert.equal(descriptor.frameCount, 4800);
	assert.deepEqual(descriptor.metadataWarnings, []);
	const metadata = descriptor.ixml;
	assert.ok(metadata);
	assert.equal(metadata.note, note);
	assert.equal(metadata.rawXml, xml);
	assert.equal(new TextDecoder().decode(encodeIxmlPayload(metadata)), xml);
});

test('iXML still refuses actual internal and external declarations and undefined entities', () => {
	for (const xml of [
		'<!DOCTYPE BWFXML SYSTEM "https://example.invalid/recorder.dtd"><BWFXML/>',
		'<!DOCTYPE BWFXML [<!ENTITY example "expanded">]><BWFXML><NOTE>&example;</NOTE></BWFXML>',
		'<!DOCTYPE BWFXML [<!ENTITY example SYSTEM "file:///private/recording">]><BWFXML/>',
		'<BWFXML><NOTE>&example;</NOTE></BWFXML>',
		'<!ENTITY example "expanded"><BWFXML/>',
	]) assert.throws(() => parseIxmlPayload(new TextEncoder().encode(xml)), /Active XML|well-formed XML/u);
});
