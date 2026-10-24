/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { BufferSource, EncodedPacketSink, Input, MP4 } from 'mediabunny';
import { readAacSourceMetadata, validateAacSourceGeometry } from '../src/common/editor/aac-source-geometry.ts';
import { foreignScafAacFixture } from './helpers/foreign-scaf-aac-fixture.ts';

for (const variant of ['foreign', 'unrelated', 'plain'] as const) test(`ordinary AAC ${variant} metadata does not claim private source geometry`, async () => {
	assert.equal(await readAacSourceMetadata(foreignScafAacFixture(variant).file), null);
});

test('ordinary producer variants retain identical selected AAC packets and authored presentation', async () => {
	const packets: Uint8Array[][] = [];
	for (const variant of ['foreign', 'unrelated', 'plain'] as const) {
		const input = new Input({ source: new BufferSource(await foreignScafAacFixture(variant).file.arrayBuffer()), formats: [MP4] });
		try {
			const track = await input.getPrimaryAudioTrack(); assert.ok(track);
			assert.equal(await track.getSampleRate(), 32_000); assert.equal(await track.getNumberOfChannels(), 2);
			const values: Uint8Array[] = [];
			for await (const packet of new EncodedPacketSink(track).packets()) values.push(Uint8Array.from(packet.data));
			assert.ok(values.length > 0); packets.push(values);
		} finally { input.dispose(); }
	}
	assert.deepEqual(packets[0], packets[1]); assert.deepEqual(packets[0], packets[2]);
});

function box(type: string, ...parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
	const bytes = new Uint8Array(8 + parts.reduce((sum, part) => sum + part.length, 0));
	new DataView(bytes.buffer).setUint32(0, bytes.length); bytes.set(new TextEncoder().encode(type), 4);
	let offset = 8; for (const part of parts) { bytes.set(part, offset); offset += part.length; }
	return bytes;
}
function metadataFile(...values: readonly Readonly<{ text: string; type?: number; locale?: number; utf16?: boolean; littleEndian?: boolean }>[]): Blob {
	return new Blob([box('ftyp'), box('moov', box('udta', box('meta', new Uint8Array(4), box('ilst', ...values.map(value => {
		const header = new Uint8Array(8), view = new DataView(header.buffer);
		view.setUint32(0, value.type ?? 1); view.setUint32(4, value.locale ?? 0);
		const payload = value.utf16 ? Uint8Array.from([...value.text].flatMap(character => value.littleEndian ? [character.charCodeAt(0), 0] : [0, character.charCodeAt(0)])) : new TextEncoder().encode(value.text);
		return box('scaf', box('data', header, payload));
	})))))]);
}

test('foreign private-key values remain optional without enlarging metadata reads', async () => {
	const file = metadataFile({ text: 'x'.repeat(8192) }, { text: 'Foreign notes' }); let maximumRead = 0;
	class Bounded extends Blob {
		override slice(start = 0, end = this.size, type?: string): Blob { maximumRead = Math.max(maximumRead, end - start); return super.slice(start, end, type); }
	}
	assert.equal(await readAacSourceMetadata(new Bounded([file])), null); assert.ok(maximumRead <= 128);
});

test('claimed Soundscaper geometry retains strict version, size, type, locale and duplicate refusal', async () => {
	const valid = 'SoundscaperAAC1:32000:2:4800';
	assert.throws(() => validateAacSourceGeometry(null, { sampleRate: 32_000, channelCount: 2, encodedFrames: 6144 }), /AAC source geometry/u);
	assert.equal(await readAacSourceMetadata(metadataFile({ text: 'Foreign notes' }, { text: valid })), valid);
	assert.deepEqual(validateAacSourceGeometry(valid, { sampleRate: 32_000, channelCount: 2, encodedFrames: 6144 }),
		{ sourceFrames: 4800, leadingFrames: 1024, trailingFrames: 320 });
	for (const text of ['SoundscaperAAC1:garbage', 'SoundscaperAAC2:32000:2:4800', 'SoundscaperAAC1:32000:2:0']) {
		assert.equal(await readAacSourceMetadata(metadataFile({ text })), text);
		assert.throws(() => validateAacSourceGeometry(text, { sampleRate: 32_000, channelCount: 2, encodedFrames: 6144 }), /AAC source geometry/u);
	}
	for (const values of [[{ text: valid }, { text: valid }], [{ text: valid, type: 0 }], [{ text: valid, type: 2 }], [{ text: valid, type: 2, utf16: true }], [{ text: valid, type: 1, utf16: true }],
		[{ text: valid, type: 0, utf16: true }], [{ text: valid, type: 0, utf16: true, littleEndian: true }], [{ text: valid, type: 2, utf16: true, littleEndian: true }],
		[{ text: `\ufeff${valid}` }], [{ text: `${valid}é` }], [{ text: valid, locale: 1 }],
		[{ text: `SoundscaperAAC1:${'x'.repeat(129)}` }]]) await assert.rejects(readAacSourceMetadata(metadataFile(...values)), /AAC source metadata/u);
});
