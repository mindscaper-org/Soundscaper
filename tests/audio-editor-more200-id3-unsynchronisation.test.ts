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
import { createAudioMetadataId3Tag } from '../src/common/editor/id3-metadata.js';
import { normalizeMediaMetadata } from '../src/common/editor/media-metadata.ts';
import { createExportDialogInitialSettings } from '../src/common/editor/ui/export-dialog-initial-settings.ts';
import { createExportDialogRequest } from '../src/common/editor/ui/export-dialog-model.js';
import { exportDialogMetadata } from '../src/common/editor/ui/export-dialog-audio-codec-options.ts';
import { exportDialogMetadataFields } from '../src/common/editor/ui/export-dialog-metadata-fields.ts';
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

for (const encoding of [0, 1] as const) test(`File Open preserves legacy ID3v2.2 user-defined text values (encoding=${encoding})`, async () => {
	const userText = textList(encoding, ['Composer credit', encoding === 0 ? 'Björk' : '作品']);
	const header = Buffer.alloc(6); header.write('TXX'); header.writeUIntBE(userText.length, 3, 3);
	const title = Buffer.from('\0Legacy title'), titleHeader = Buffer.alloc(6);
	titleHeader.write('TT2'); titleHeader.writeUIntBE(title.length, 3, 3);
	const body = Buffer.concat([header, userText, titleHeader, title]);
	const metadata = Uint8Array.from(Buffer.concat([Buffer.from([73, 68, 51, 2, 0, 0]), syncSafe(body.length), body]));
	const contribution = await importedMetadata(metadata);
	assert.deepEqual(contribution.warnings, []);
	assert.equal(contribution.metadata.normalized.title, 'Legacy title');
	assert.deepEqual(contribution.metadata.raw.TXX, { 'Composer credit': encoding === 0 ? 'Björk' : '作品' });
	for (const bundle of ['mediabunny.cjs', 'mediabunny.node.cjs', 'mediabunny.mjs']) {
		const { stdout } = await runNode(process.execPath, ['--input-type=module', '-e', `
			const module=await import('./node_modules/mediabunny/dist/bundles/'+process.argv[1]);
			const {Input,BlobSource,ALL_FORMATS}=module.default??module;
			const input=new Input({source:new BlobSource(new Blob([Buffer.from(process.argv[2],'base64')])),formats:ALL_FORMATS});
			try{console.log(JSON.stringify((await input.getMetadataTags()).raw.TXX));}finally{input.dispose();}
		`, bundle, Buffer.concat([metadata, await mp3()]).toString('base64')], { timeout: 10_000 });
		assert.deepEqual(JSON.parse(stdout) as unknown, { 'Composer credit': encoding === 0 ? 'Björk' : '作品' }, bundle);
	}
});

for (const unsynchronised of [false, true]) test(`File Open retains legacy ID3v2.2 text and PIC artwork (unsync=${unsynchronised})`, async () => {
	const legacyFrame = (id: string, payload: Uint8Array): Buffer => {
		const header = Buffer.alloc(6); header.write(id); header.writeUIntBE(payload.length, 3, 3);
		return Buffer.concat([header, payload]);
	};
	const picture = Buffer.concat([Buffer.from([0]), Buffer.from('JPG'), Buffer.from([3, 0]), jpeg]);
	const frames = Buffer.concat([legacyFrame('PIC', picture), legacyFrame('TT2', Buffer.from('\0Legacy title')),
		legacyFrame('TP1', Buffer.from('\0Legacy performer')), legacyFrame('TAL', Buffer.from('\0Legacy album'))]);
	const body = unsynchronised ? unsynchronise(frames) : frames;
	const metadata = Uint8Array.from(Buffer.concat([Buffer.from([73, 68, 51, 2, 0, unsynchronised ? 128 : 0]), syncSafe(body.length), body]));
	const contribution = await importedMetadata(metadata);
	assert.deepEqual(contribution.warnings, []);
	assert.equal(contribution.metadata.normalized.title, 'Legacy title');
	assert.equal(contribution.metadata.normalized.artist, 'Legacy performer');
	assert.equal(contribution.metadata.normalized.album, 'Legacy album');
	const image = contribution.attachments.find(({ path }) => path === 'images[0]');
	assert.equal(image?.sha256, imageHash);
	assert.equal(image?.byteLength, jpeg.length);
});

for (const [timestamp, expected] of [
	['2024', '2024-01-01T00:00:00.000Z'], ['2024-07', '2024-07-01T00:00:00.000Z'],
	['2024-07-21', '2024-07-21T00:00:00.000Z'], ['2024-07-21T16', '2024-07-21T16:00:00.000Z'],
	['2024-07-21T16:45', '2024-07-21T16:45:00.000Z'], ['2024-07-21T16:45:30', '2024-07-21T16:45:30.000Z'],
] as const) test(`File Open interprets the supported ID3 UTC timestamp precision ${timestamp}`, async () => {
	const previous = process.env.TZ;
	process.env.TZ = 'Pacific/Honolulu';
	try {
		const body = frame(4, 'TDRC', Buffer.from(`\0${timestamp}`));
		const metadata = Uint8Array.from(Buffer.concat([Buffer.from([73, 68, 51, 4, 0, 0]), syncSafe(body.length), body]));
		const contribution = await importedMetadata(metadata);
		assert.deepEqual(contribution.warnings, []);
		assert.equal(contribution.metadata.normalized.date, expected);
		assert.equal(contribution.metadata.raw.TDRC, timestamp);
		if (timestamp.includes('T')) for (const bundle of ['mediabunny.cjs', 'mediabunny.node.cjs', 'mediabunny.mjs']) {
			const { stdout } = await runNode(process.execPath, ['--input-type=module', '-e', `
				const module=await import('./node_modules/mediabunny/dist/bundles/'+process.argv[1]);
				const {Input,BlobSource,ALL_FORMATS}=module.default??module;
				const input=new Input({source:new BlobSource(new Blob([Buffer.from(process.argv[2],'base64')])),formats:ALL_FORMATS});
				try{console.log(JSON.stringify((await input.getMetadataTags()).date?.toISOString()));}finally{input.dispose();}
			`, bundle, Buffer.concat([metadata, await mp3()]).toString('base64')], { timeout: 10_000 });
			assert.equal(JSON.parse(stdout) as unknown, expected, bundle);
		}
	} finally {
		if (previous === undefined) delete process.env.TZ; else process.env.TZ = previous;
	}
});

test('File Open retains an APIC image with a UTF-16BE description and an ASCII MIME field', async () => {
	const description = Buffer.from('作品', 'utf16le').swap16();
	const picture = Buffer.concat([Buffer.from([2]), Buffer.from('image/jpeg\0'), Buffer.from([3]), description, Buffer.from([0, 0]), jpeg]);
	const body = Buffer.concat([frame(4, 'APIC', picture), frame(4, 'TIT2', Buffer.from('\0Following title'))]);
	const metadata = Uint8Array.from(Buffer.concat([Buffer.from([73, 68, 51, 4, 0, 0]), syncSafe(body.length), body]));
	const contribution = await importedMetadata(metadata);
	assert.deepEqual(contribution.warnings, []);
	assert.equal(contribution.metadata.normalized.title, 'Following title');
	const image = contribution.attachments.find(({ path }) => path === 'images[0]');
	assert.equal(image?.description, '作品');
	assert.equal(image?.mimeType, 'image/jpeg');
	assert.equal(image?.byteLength, jpeg.length);
	assert.equal(image?.sha256, imageHash);
});

function textList(encoding: 0 | 1 | 2 | 3, values: readonly string[]): Buffer {
	return Buffer.concat([Buffer.from([encoding]), ...values.flatMap((value, index) => {
		const terminator = index < values.length - 1 ? Buffer.alloc(encoding === 1 || encoding === 2 ? 2 : 1) : Buffer.alloc(0);
		const text = encoding === 1 ? Buffer.concat([Buffer.from([255, 254]), Buffer.from(value, 'utf16le')])
			: encoding === 2 ? Buffer.from(value, 'utf16le').swap16() : Buffer.from(value, encoding === 0 ? 'latin1' : 'utf8');
		return [text, terminator];
	})]);
}

test('MP3 export and File Open retain custom text names that match Object properties', async () => {
	const custom = Object.fromEntries([['constructor', 'First credit'], ['toString', 'Second credit']]);
	const settings = { ...createExportDialogInitialSettings({ sampleRate: 48_000 }), format: 'mp3', metadataCustom: JSON.stringify(custom) };
	const request = createExportDialogRequest(settings, { metadata: exportDialogMetadata('mp3', false, exportDialogMetadataFields(settings, custom)) });
	const contribution = await importedMetadata(Uint8Array.from(createAudioMetadataId3Tag(normalizeMediaMetadata(request.metadata))));
	assert.deepEqual(contribution.warnings, []);
	assert.deepEqual(contribution.metadata.raw.TXXX, custom);
	const external = { ...custom, ...Object.fromEntries([['__proto__', 'Third credit']]) };
	const input = new Input({ source: new BlobSource(new Blob([Uint8Array.from(createAudioMetadataId3Tag(external)), await mp3()])), formats: ALL_FORMATS });
	try { assert.deepEqual((await input.getMetadataTags()).raw?.TXXX, external); }
	finally { input.dispose(); }
});

for (const encoding of [0, 1, 2, 3] as const) test(`File Open retains every value in ID3v2.4 text lists (encoding${encoding})`, async () => {
	const body = Buffer.concat([frame(4, 'TPE1', textList(encoding, ['Lead performer', 'Guest performer'])),
		frame(4, 'TIT2', textList(encoding, ['First title', 'Second title'])),
		frame(4, 'TXXX', textList(encoding, ['Credits', 'First credit', 'Second credit'])),
		frame(4, 'TRCK', textList(encoding, ['2/9', '3/9'])),
		frame(4, 'TDRC', textList(encoding, ['2024-07-21', '2025-07-21']))]);
	const metadata = Uint8Array.from(Buffer.concat([Buffer.from([73, 68, 51, 4, 0, 0]), syncSafe(body.length), body]));
	const contribution = await importedMetadata(metadata);
	assert.deepEqual(contribution.warnings, []);
	assert.equal(contribution.metadata.normalized.artist, 'Lead performer; Guest performer');
	assert.equal(contribution.metadata.normalized.title, 'First title; Second title');
	assert.equal(contribution.metadata.raw.TPE1, 'Lead performer\0Guest performer');
	assert.deepEqual(contribution.metadata.raw.TXXX, { Credits: 'First credit; Second credit' });
	assert.equal(contribution.metadata.normalized.trackNumber, 2);
	assert.equal(contribution.metadata.normalized.tracksTotal, 9);
	assert.equal(contribution.metadata.normalized.date, '2024-07-21T00:00:00.000Z');
	assert.equal(contribution.metadata.raw.TRCK, '2/9\u00003/9');
	assert.equal(contribution.metadata.raw.TDRC, '2024-07-21\u00002025-07-21');
});

async function mp3(): Promise<Uint8Array<ArrayBuffer>> {
	const pcm = Float32Array.from({ length: 4800 }, (_, frame) => .2 * Math.sin(frame * .05));
	return encodeDedicatedAudioPcm({ format: 'mp3', input: new Uint8Array(pcm.buffer), frameCount: pcm.length,
		sampleRate: 48_000, channelCount: 1, settings: { bitrateKbps: 192 }, maximumOutputBytes: 1024 ** 2 },
	{ loadPayload: async (_format, url) => Uint8Array.from(await readFile(url)) });
}

async function importedMetadata(metadata: Uint8Array<ArrayBuffer>, trailer = new Uint8Array()) {
	const audio = await mp3();
	const originalFetch = globalThis.fetch;
	globalThis.fetch = async (input, init) => input instanceof URL && input.protocol === 'file:'
		? new Response(Uint8Array.from(await readFile(input))) : originalFetch(input, init);
	const { store } = await createTwoTrackFixture('more200-unsynchronised-id3', new Map<string, Float32Array>(), 48_000);
	const controller = createController(store, undefined);
	try {
		await controller.ready;
		await controller.actions.project.importFiles([new File([audio], 'Plain.mp3', { type: 'audio/mpeg' }),
			new File([metadata, audio, trailer], 'Tagged.mp3', { type: 'audio/mpeg' })], { destination: 'timeline' });
		const project = controller.getSnapshot().project;
		assert.ok(validateAudioEditorProjectV17(project));
		assert.equal(project.sources.length, 2);
		const [plain, tagged] = project.sources;
		assert.deepEqual(await storedChannel(store, tagged!.id, 0), await storedChannel(store, plain!.id, 0));
		return normalizeSourceProvenance(tagged!.provenance).contributions[0]!;
	} finally { await controller.dispose(); globalThis.fetch = originalFetch; }
}

for (const padding of [0, 32]) for (const modernTitle of ['', 'Modern title']) {
	test(`File Open fills missing ID3v2 fields from a valid ID3v1 trailer (pad${padding}, modern=${Boolean(modernTitle)})`, async () => {
		const trailer = new Uint8Array(128).fill(padding);
		for (const [offset, value] of [[0, 'TAG'], [3, 'Legacy title'], [33, 'Legacy performer'], [63, 'Legacy album'], [93, '2021'], [97, 'Legacy comment']] as const) {
			trailer.set(Buffer.from(value, 'latin1'), offset);
		}
		trailer[125] = 0; trailer[126] = 7; trailer[127] = 17;
		const metadata = Uint8Array.from(createAudioMetadataId3Tag({ credit: 'Modern credit', ...(modernTitle ? { title: modernTitle } : {}) }));
		const contribution = await importedMetadata(metadata, trailer);
		assert.deepEqual(contribution.warnings, []);
		assert.equal(contribution.metadata.normalized.title, modernTitle || 'Legacy title');
		assert.equal(contribution.metadata.normalized.artist, 'Legacy performer');
		assert.equal(contribution.metadata.normalized.album, 'Legacy album');
		assert.equal(contribution.metadata.normalized.comment, 'Legacy comment');
		assert.equal(contribution.metadata.normalized.trackNumber, 7);
		assert.deepEqual(contribution.metadata.raw.TXXX, { credit: 'Modern credit' });
	});
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
		const prefix = Buffer.concat([grouping ? Buffer.from([129]) : Buffer.alloc(0), length ? syncSafe(title.length) : Buffer.alloc(0)]);
		const header = Buffer.alloc(10);
		header.write('TIT2');
		if (version === 3) header.writeUInt32BE(prefix.length + title.length, 4);
		else header.set(syncSafe(prefix.length + title.length), 4);
		header[9] = (grouping ? version === 3 ? 32 : 64 : 0) | (length ? 1 : 0);
		const registration = grouping ? frame(version, 'GRID', Buffer.concat([Buffer.from('https://example.org/group\0'), Buffer.from([129])])) : Buffer.alloc(0);
		const body = Buffer.concat([registration, header, prefix, title, frame(version, 'TPE1', Buffer.from('\0Independent artist'))]);
		const metadata = Uint8Array.from(Buffer.concat([Buffer.from([73, 68, 51, version, 0, 0]), syncSafe(body.length), body]));
		const contribution = await importedMetadata(metadata);
		assert.deepEqual(contribution.warnings, []);
		assert.equal(contribution.metadata.normalized.title, 'Grouped title');
		assert.equal(contribution.metadata.normalized.artist, 'Independent artist');
	});
}

for (const fields of [
	[['TYER', '2024'], ['TDAT', '2107'], ['TIME', '1645']],
	[['TDAT', '2107'], ['TIME', '1645'], ['TYER', '2024']],
] as const) test(`File Open combines legacy ID3 recording date fields starting with ${fields[0][0]}`, async () => {
	const body = Buffer.concat(fields.map(([id, value]) => frame(3, id, Buffer.from(`\0${value}`))));
	const metadata = Uint8Array.from(Buffer.concat([Buffer.from([73, 68, 51, 3, 0, 0]), syncSafe(body.length), body]));
	const contribution = await importedMetadata(metadata);
	assert.deepEqual(contribution.warnings, []);
	assert.equal(contribution.metadata.normalized.date, '2024-07-21T16:45:00.000Z');
	assert.equal(contribution.metadata.raw.TYER, '2024');
	assert.equal(contribution.metadata.raw.TDAT, '2107');
	assert.equal(contribution.metadata.raw.TIME, '1645');
	for (const bundle of ['mediabunny.cjs', 'mediabunny.node.cjs', 'mediabunny.mjs']) {
		const bytes = Buffer.concat([metadata, await mp3()]);
		const { stdout } = await runNode(process.execPath, ['--input-type=module', '-e', `
			const module=await import('./node_modules/mediabunny/dist/bundles/'+process.argv[1]);
			const {Input,BlobSource,ALL_FORMATS}=module.default??module;
			const input=new Input({source:new BlobSource(new Blob([Buffer.from(process.argv[2],'base64')])),formats:ALL_FORMATS});
			try{console.log((await input.getMetadataTags()).date.toISOString());}finally{input.dispose();}
		`, bundle, bytes.toString('base64')], { timeout: 10_000 });
		assert.equal(stdout.trim(), '2024-07-21T16:45:00.000Z', bundle);
	}
});
