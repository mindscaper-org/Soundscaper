/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import test from 'node:test';
import { ALL_FORMATS, BlobSource, Input } from 'mediabunny';
import { encodeDedicatedAudioPcm } from '../src/common/editor/browser-dedicated-audio-codec.ts';
import { validateAudioEditorProjectV17 } from '../src/common/editor/project-v17-validation.ts';
import { normalizeSourceProvenance } from '../src/common/editor/source-provenance.ts';
import { createController, createTwoTrackFixture, storedChannel } from './helpers/audio-editor-multitrack-selection-harness.js';

const runNode = promisify(execFile);
// A valid one-pixel JPEG; its normal marker bytes require ID3 unsynchronisation.
const jpeg = Buffer.from('/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAMCAgICAgMCAgIDAwMDBAYEBAQEBAgGBgUGCQgKCgkICQkKDA8MCgsOCwkJDRENDg8QEBEQCgwSExIQEw8QEBD/2wBDAQMDAwQDBAgEBAgQCwkLEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBD/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAn/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFAEBAAAAAAAAAAAAAAAAAAAAAP/EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAMAwEAAhEDEQA/AJVAA//Z', 'base64');
const imageHash = createHash('sha256').update(jpeg).digest('hex');

function syncSafe(value: number): Uint8Array<ArrayBuffer> {
	return Uint8Array.of(value >>> 21 & 127, value >>> 14 & 127, value >>> 7 & 127, value & 127);
}

function unsynchronise(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
	const output: number[] = [];
	for (let index = 0; index < bytes.length; index++) {
		const value = bytes[index]!;
		output.push(value);
		if (value === 255 && (index === bytes.length - 1 || bytes[index + 1] === 0 || bytes[index + 1]! >= 224)) output.push(0);
	}
	return Uint8Array.from(output);
}

function frame(version: 3 | 4, id: string, body: Uint8Array): Buffer {
	const payload = version === 4 ? unsynchronise(body) : body;
	const header = Buffer.alloc(10);
	header.write(id);
	if (version === 4) header.set(syncSafe(payload.length), 4);
	else header.writeUInt32BE(payload.length, 4);
	if (version === 4) header[9] = 2;
	return Buffer.concat([header, payload]);
}

function tag(version: 3 | 4): Uint8Array<ArrayBuffer> {
	const picture = Buffer.concat([Buffer.from([0]), Buffer.from('image/jpeg\0'), Buffer.from([3, 0]), jpeg]);
	const body = Buffer.concat([frame(version, 'APIC', picture), frame(version, 'TIT2', Buffer.from('\0Following title')),
		frame(version, 'TPE1', Buffer.from('\0Following artist'))]);
	const payload = version === 3 ? unsynchronise(body) : body;
	return Uint8Array.from(Buffer.concat([Buffer.from([73, 68, 51, version, 0, version === 3 ? 128 : 0]), syncSafe(payload.length), payload]));
}

async function mp3(): Promise<Uint8Array<ArrayBuffer>> {
	const pcm = Float32Array.from({ length: 4800 }, (_, frame) => .2 * Math.sin(frame * .05));
	return encodeDedicatedAudioPcm({ format: 'mp3', input: new Uint8Array(pcm.buffer), frameCount: pcm.length,
		sampleRate: 48_000, channelCount: 1, settings: { bitrateKbps: 192 }, maximumOutputBytes: 1024 ** 2 },
	{ loadPayload: async (_format, url) => Uint8Array.from(await readFile(url)) });
}

async function importedMetadata(metadata: Uint8Array<ArrayBuffer>) {
	const audio = await mp3();
	const originalFetch = globalThis.fetch;
	globalThis.fetch = async (input, init) => input instanceof URL && input.protocol === 'file:'
		? new Response(Uint8Array.from(await readFile(input))) : originalFetch(input, init);
	const { store } = await createTwoTrackFixture('more200-unsynchronised-id3', new Map<string, Float32Array>(), 48_000);
	const controller = createController(store, undefined);
	try {
		await controller.ready;
		await controller.actions.project.importFiles([new File([audio], 'Plain.mp3', { type: 'audio/mpeg' }),
			new File([metadata, audio], 'Tagged.mp3', { type: 'audio/mpeg' })], { destination: 'timeline' });
		const project = controller.getSnapshot().project;
		assert.ok(validateAudioEditorProjectV17(project));
		assert.equal(project.sources.length, 2);
		const [plain, tagged] = project.sources;
		assert.deepEqual(await storedChannel(store, tagged!.id, 0), await storedChannel(store, plain!.id, 0));
		return normalizeSourceProvenance(tagged!.provenance).contributions[0]!;
	} finally { await controller.dispose(); globalThis.fetch = originalFetch; }
}

for (const version of [3, 4] as const) test(`File Open retains unsynchronised ID3v2.${version} artwork and following fields`, async () => {
	const contribution = await importedMetadata(tag(version));
	assert.deepEqual(contribution.warnings, []);
	assert.equal(contribution.metadata.normalized.title, 'Following title');
	assert.equal(contribution.metadata.normalized.artist, 'Following artist');
	const image = contribution.attachments.find(({ path }) => path === 'images[0]');
	assert.equal(image?.byteLength, jpeg.length);
	assert.equal(image?.sha256, imageHash);
});

for (const version of [3, 4] as const) test(`ID3v2.${version} parser retains exact binary metadata across shipped consumers`, async () => {
	const bytes = Buffer.concat([tag(version), await mp3()]);
	const input = new Input({ source: new BlobSource(new Blob([bytes])), formats: ALL_FORMATS });
	try {
		const tags = await input.getMetadataTags();
		assert.equal(tags.title, 'Following title');
		assert.deepEqual(tags.images?.[0]?.data, new Uint8Array(jpeg));
		assert.deepEqual(tags.raw?.APIC, new Uint8Array(Buffer.concat([Buffer.from([0]), Buffer.from('image/jpeg\0'), Buffer.from([3, 0]), jpeg])));
	} finally { input.dispose(); }
	for (const bundle of ['mediabunny.cjs', 'mediabunny.node.cjs', 'mediabunny.mjs']) {
		const { stdout } = await runNode(process.execPath, ['--input-type=module', '-e', `
			const module=await import('./node_modules/mediabunny/dist/bundles/'+process.argv[1]);
			const {Input,BlobSource,ALL_FORMATS}=module.default??module;
			const input=new Input({source:new BlobSource(new Blob([Buffer.from(process.argv[2],'base64')])),formats:ALL_FORMATS});
			try{const tags=await input.getMetadataTags();console.log(JSON.stringify({title:tags.title,image:Buffer.from(tags.images[0].data).toString('base64')}));}
			finally{input.dispose();}
		`, bundle, bytes.toString('base64')], { timeout: 10_000 });
		assert.deepEqual(JSON.parse(stdout) as unknown, { title: 'Following title', image: jpeg.toString('base64') }, bundle);
	}
});

for (const [version, grouping, length] of [[3, true, false], [4, true, false], [4, false, true], [4, true, true]] as const) {
	test(`File Open reads ID3v2.${version} frame prefixes (group=${grouping}, length=${length})`, async () => {
		const title = Buffer.from('\0Grouped title');
		const prefix = Buffer.concat([grouping ? Buffer.from([17]) : Buffer.alloc(0), length ? syncSafe(title.length) : Buffer.alloc(0)]);
		const header = Buffer.alloc(10);
		header.write('TIT2');
		if (version === 3) header.writeUInt32BE(prefix.length + title.length, 4);
		else header.set(syncSafe(prefix.length + title.length), 4);
		header[9] = (grouping ? version === 3 ? 32 : 64 : 0) | (length ? 1 : 0);
		const body = Buffer.concat([header, prefix, title, frame(version, 'TPE1', Buffer.from('\0Independent artist'))]);
		const metadata = Uint8Array.from(Buffer.concat([Buffer.from([73, 68, 51, version, 0, 0]), syncSafe(body.length), body]));
		const contribution = await importedMetadata(metadata);
		assert.deepEqual(contribution.warnings, []);
		assert.equal(contribution.metadata.normalized.title, 'Grouped title');
		assert.equal(contribution.metadata.normalized.artist, 'Independent artist');
	});
}
