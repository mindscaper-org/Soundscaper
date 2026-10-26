/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { demuxVideoTiming } from '../src/common/editor/video-timing-demux.ts';
import { readContainerVideoSourceCharacteristics } from '../src/common/editor/video-container-characteristics.ts';
import { createDeterministicAvFixture, createDeterministicSilentVideoFixture } from './browser/fixtures/deterministic-av-media.js';

for (const kind of [1, 2]) test(`container characteristics ignore TrackEntry child ordering; kind=${kind}`, async () => {
	const fixture = createDeterministicAvFixture('camera.webm');
	const bytes = fixture.buffer;
	const reordered = reorderedTrackSettings(bytes, kind);
	assert.equal(reordered.length, bytes.length);
	const cluster = bytes.indexOf(Buffer.from([0x1f, 0x43, 0xb6, 0x75]), bytes.lastIndexOf(Buffer.from([0x16, 0x54, 0xae, 0x6b])));
	assert.ok(cluster > 0);
	assert.deepEqual(reordered.subarray(cluster), bytes.subarray(cluster), 'every media packet and cue remains byte exact');
	const before = await demuxVideoTiming(new Blob([Uint8Array.from(bytes)]));
	const after = await demuxVideoTiming(new Blob([Uint8Array.from(reordered)]));
	assert.equal(after.timescale, before.timescale);
	assert.deepEqual(after.presentationTicks, before.presentationTicks);
	assert.equal(after.finalFrameDurationTicks, before.finalFrameDurationTicks);
	const original = await readContainerVideoSourceCharacteristics(new Blob([Uint8Array.from(bytes)]));
	assert.equal(original.videoCodec, 'vp8');
	assert.equal(original.codedWidth, 96);
	assert.equal(original.codedHeight, 54);
	assert.deepEqual(await readContainerVideoSourceCharacteristics(new Blob([Uint8Array.from(reordered)])), original);
});


test('a reordered unsupported TrackType remains unsupported instead of inferring video from settings', async () => {
	const bytes = reorderedTrackSettings(createDeterministicSilentVideoFixture('camera.webm').buffer);
	const type = bytes.indexOf(Buffer.from([0x83, 0x81, 0x01]), bytes.lastIndexOf(Buffer.from([0x16, 0x54, 0xae, 0x6b])));
	assert.ok(type > 0); bytes[type + 2] = 3;
	const characteristics = await readContainerVideoSourceCharacteristics(new Blob([Uint8Array.from(bytes)]));
	assert.equal(characteristics.videoCodec, null);
	assert.equal(characteristics.codedWidth, null);
});

for (const bundle of ['mediabunny.cjs', 'mediabunny.node.cjs', 'mediabunny.mjs']) test(`shipped ${bundle} retains reordered video track settings`, async () => {
	const bytes = reorderedTrackSettings(createDeterministicSilentVideoFixture('camera.webm').buffer);
	const { stdout } = await promisify(execFile)(process.execPath, ['--input-type=module', '-e', `
		const imported=await import('./node_modules/mediabunny/dist/bundles/'+process.argv[1]);
		const {Input,BlobSource,WEBM}=imported.default??imported;
		const input=new Input({source:new BlobSource(new Blob([Buffer.from(process.argv[2],'base64')])),formats:[WEBM]});
		try{const track=await input.getPrimaryVideoTrack(); console.log(JSON.stringify(track?{width:await track.getCodedWidth(),codec:await track.getCodec()}:null));}finally{input.dispose();}
	`, bundle, bytes.toString('base64')], { timeout: 10_000 });
	assert.deepEqual(JSON.parse(stdout) as unknown, { width: 96, codec: 'vp8' });
});

// Only reorder complete direct children of the authenticated TrackEntry. This
// keeps all source packets, cue offsets, element sizes and timestamps identical.
function reorderedTrackSettings(bytes: Buffer, kind = 1): Buffer {
	const tracks = element(bytes, bytes.lastIndexOf(Buffer.from([0x16, 0x54, 0xae, 0x6b])));
	for (let offset = tracks.body; offset < tracks.end;) {
		const entry = element(bytes, offset); offset = entry.end;
		if (entry.id !== 0xae) continue;
		const children: ReturnType<typeof element>[] = [];
		for (let position = entry.body; position < entry.end;) {
			const child = element(bytes, position); children.push(child); position = child.end;
		}
		const type = children.find(child => child.id === 0x83);
		if (!type || bytes[type.body] !== kind) continue;
		const settings = children.find(child => child.id === (kind === 1 ? 0xe0 : 0xe1));
		assert.ok(settings && settings.start > type.start);
		return Buffer.concat([bytes.subarray(0, type.start), bytes.subarray(settings.start, settings.end),
			bytes.subarray(type.start, settings.start), bytes.subarray(settings.end)]);
	}
	throw new Error('The authenticated fixture has no matching track.');
}

function element(bytes: Buffer, start: number): { start: number; body: number; end: number; id: number } {
	assert.ok(start >= 0 && start < bytes.length);
	const width = (offset: number): number => {
		let length = 1; while (length <= 8 && (bytes[offset]! & (0x80 >> (length - 1))) === 0) length++;
		assert.ok(length <= 8); return length;
	};
	const idLength = width(start), sizeLength = width(start + idLength);
	const id = bytes.readUIntBE(start, idLength);
	let size = bytes[start + idLength]! & ((1 << (8 - sizeLength)) - 1);
	for (let i = 1; i < sizeLength; i++) size = size * 256 + bytes[start + idLength + i]!;
	const body = start + idLength + sizeLength;
	assert.ok(body + size <= bytes.length);
	return { start, body, end: body + size, id };
}
