/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { BlobSource, Input, MP3 } from 'mediabunny';
import { encodeDedicatedAudioPcm } from '../../src/common/editor/browser-dedicated-audio-codec.ts';
import { createAudioMetadataId3Tag } from '../../src/common/editor/id3-metadata.js';

interface PinnedCore {
	exec(...arguments_: string[]): number;
	setLogger(listener: (event: Readonly<{ message: string }>) => void): void;
	readonly FS: {
		writeFile(path: string, bytes: Uint8Array): void;
		readFile(path: string): Uint8Array;
		unlink(path: string): void;
	};
}

const CORE_JAVASCRIPT = new URL('../../node_modules/@ffmpeg/core/dist/esm/ffmpeg-core.js', import.meta.url);
const CORE_WASM = new URL('../../node_modules/@ffmpeg/core/dist/esm/ffmpeg-core.wasm', import.meta.url);
let corePromise: Promise<PinnedCore> | undefined;

/** The documented FFmpeg MP3/APIC writer authors a supported CBR programme with ordinary front/back cover photographs. */
export async function ordinaryCoverMp3Fixture(illustrated: boolean): Promise<File> {
	const core = await (corePromise ??= loadCore());
	const input = 'ordinary-cover-input.mp3', cover = 'ordinary-cover.png', output = 'ordinary-cover-output.mp3';
	const messages: string[] = [];
	core.setLogger(({ message }) => { messages.push(message); if (messages.length > 30) messages.shift(); });
	let encoded: Uint8Array<ArrayBuffer>;
	try {
		const original = Uint8Array.from(Buffer.from(await readFile(new URL('../fixtures/ffmpeg-libmp3lame-one-second.mp3.base64', import.meta.url), 'utf8'), 'base64'));
		core.FS.writeFile(input, original);
		// Public-domain NASA photograph, with existing provenance/notice in the fixture directory.
		core.FS.writeFile(cover, await readFile(new URL('../electron/local-assistance-models/fixtures/astronaut.png', import.meta.url)));
		const code = core.exec('-hide_banner', '-nostdin', '-y', '-i', input,
			...(illustrated ? ['-i', cover] : []), '-map', '0:a:0',
			...(illustrated ? ['-map', '1:v:0', '-map', '1:v:0', '-c:v', 'copy',
				'-metadata:s:v:0', 'comment=Cover (front)', '-metadata:s:v:1', 'comment=Cover (back)'] : []),
			'-c:a', 'libmp3lame', '-b:a', '128k', '-metadata', 'title=Space programme', output);
		assert.equal(code, 0, messages.join('\n'));
		encoded = Uint8Array.from(core.FS.readFile(output));
	} finally {
		core.setLogger(() => {});
		for (const path of [input, cover, output]) { try { core.FS.unlink(path); } catch { /* A failed mux may have no output. */ } }
	}
	const file = new File([encoded], 'Programme.mp3', { type: 'audio/mpeg' });
	const readback = new Input({ source: new BlobSource(file), formats: [MP3] });
	try {
		const audio = await readback.getPrimaryAudioTrack();
		assert.equal(audio?.codec, 'mp3');
		assert.equal(audio?.sampleRate, 48_000);
		assert.equal(audio?.numberOfChannels, 1);
		assert.ok(await readback.computeDuration() > 0.9);
		const tags = await readback.getMetadataTags();
		assert.equal(tags.images?.length ?? 0, illustrated ? 2 : 0);
		if (illustrated) assert.ok(file.size > 1024 ** 2);
	} finally { readback.dispose(); }
	return file;
}

async function loadCore(): Promise<PinnedCore> {
	if (!('self' in globalThis)) Object.defineProperty(globalThis, 'self', { configurable: true, value: globalThis });
	if (!('location' in globalThis)) Object.defineProperty(globalThis, 'location', { configurable: true, value: CORE_JAVASCRIPT });
	const [{ default: createCore }, wasmBinary] = await Promise.all([
		import(CORE_JAVASCRIPT.href) as Promise<{ default: (options: Readonly<{ wasmBinary: Uint8Array }>) => Promise<PinnedCore> }>,
		readFile(CORE_WASM),
	]);
	return await createCore({ wasmBinary });
}

/** ID3v2.4 section5 permits a footer-bearing end tag, before compatibility tags. */
export async function footerTaggedMp3Fixture(legacyTrailer = false, leading = false, update = false, artwork = false): Promise<File> {
	const audio = await ordinaryMp3Pcm();
	const cover = (description: string, blue: boolean): string => JSON.stringify([{ mimeType: 'image/png', description, pictureType: 3,
		data: blue ? 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGMQkTsBAAFEAPtKtXAbAAAAAElFTkSuQmCC'
			: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGM4IScCAAKsAPs2xCzlAAAAAElFTkSuQmCC' }]);
	const text = Uint8Array.from(createAudioMetadataId3Tag({ title: 'Footer title', artist: 'Footer performer', ...(artwork ? { id3Artwork: cover('Reviewed cover', true) } : {}) }));
	const extended = update ? Uint8Array.of(0, 0, 0, 7, 1, 64, 0) : new Uint8Array();
	const frames = Buffer.concat([extended, text.subarray(10)]);
	const header = Uint8Array.of(73, 68, 51, 4, 0, update ? 80 : 16,
		frames.length >>> 21 & 127, frames.length >>> 14 & 127, frames.length >>> 7 & 127, frames.length & 127);
	const footer = Uint8Array.from(header); footer.set([51, 68, 73]);
	const legacy = new Uint8Array(legacyTrailer ? 128 : 0);
	if (legacyTrailer) { legacy.set([84, 65, 71]); legacy.set(new TextEncoder().encode('Legacy title'), 3); }
	const earlier = Uint8Array.from(createAudioMetadataId3Tag({ title: 'Earlier title', album: 'Earlier album',
		...(artwork ? { id3Artwork: JSON.stringify([...JSON.parse(cover('Reviewed cover', false)) as unknown[], ...JSON.parse(cover('Back retained', false)) as unknown[]]) } : {}) }));
	const seek = new Uint8Array(14); seek.set(new TextEncoder().encode('SEEK')); seek[7] = 4;
	new DataView(seek.buffer).setUint32(10, audio.length);
	const earlierSize = earlier.length - 10 + seek.length;
	earlier.set([earlierSize >>> 21 & 127, earlierSize >>> 14 & 127, earlierSize >>> 7 & 127, earlierSize & 127], 6);
	return new File([...(leading ? [earlier, seek] : []),
		audio, header, frames, footer, legacy], 'Footer-tagged.mp3', { type: 'audio/mpeg' });
}

/** Each language/description and each identifier owner uniquely names a legal structured frame. */
export async function multilingualMp3Fixture(): Promise<Readonly<{ file: File; payloads: Readonly<Record<string, Uint8Array<ArrayBuffer>>>;
	records: Readonly<Record<string, Readonly<Record<string, string>>>> }>> {
	const tags = ['eng', 'deu'].map((language, index) => Uint8Array.from(createAudioMetadataId3Tag({
		lyrics: index ? 'Zweite Strophe' : 'First verse', lyricsLanguage: language, lyricsDescription: 'Reviewed translation',
		comment: index ? 'Zweiter Kommentar' : 'First comment', commentLanguage: language, commentDescription: 'Reviewed note',
		uniqueIdentifier: `edition-${index}`, identifierOwner: `https://edition-${index}.example/`,
	})));
	const frames = Buffer.concat(tags.map(tag => tag.subarray(10)));
	const header = Uint8Array.of(73, 68, 51, 4, 0, 0,
		frames.length >>> 21 & 127, frames.length >>> 14 & 127, frames.length >>> 7 & 127, frames.length & 127);
	const payloads: Record<string, Uint8Array<ArrayBuffer>> = {};
	for (const [index, tag] of tags.entries()) for (let offset = 10; offset < tag.length;) {
		const id = new TextDecoder().decode(tag.subarray(offset, offset + 4));
		const length = tag.subarray(offset + 4, offset + 8).reduce((size, byte) => size * 128 + byte, 0);
		payloads[`${id}${index ? '[1]' : ''}`] = Uint8Array.from(tag.subarray(offset + 10, offset + 10 + length));
		offset += 10 + length;
	}
	return { file: new File([header, frames, await ordinaryMp3Pcm()], 'Multilingual.mp3', { type: 'audio/mpeg' }), payloads, records: {
		'USLT[1]': { language: 'deu', description: 'Reviewed translation', text: 'Zweite Strophe' },
		'COMM[1]': { language: 'deu', description: 'Reviewed note', text: 'Zweiter Kommentar' },
		'UFID[1]': { owner: 'https://edition-1.example/', identifierHex: Buffer.from('edition-1').toString('hex') },
	} };
}

async function ordinaryMp3Pcm(): Promise<Uint8Array<ArrayBuffer>> {
	const pcm = Float32Array.from({ length: 4800 }, (_, frame) => Math.sin(frame * .03) * .2);
	return encodeDedicatedAudioPcm({ format: 'mp3', input: new Uint8Array(pcm.buffer),
		frameCount: pcm.length, sampleRate: 48_000, channelCount: 1, settings: { bitrateKbps: 192 }, maximumOutputBytes: 1024 ** 2 },
	{ loadPayload: async (_format, url) => Uint8Array.from(await readFile(url)) });
}

/** Preserve every encoded audio packet while exercising the two admitted CRC/Xing layouts. */
export async function crcOffsetMp3Fixture(layout: 'unprotected' | 'lame-crc' | 'crc-offset'): Promise<File> {
	const original = await ordinaryMp3Pcm(); const bytes = Uint8Array.from(original);
	const frameBytes = 576; const xing = 21;
	assert.equal(String.fromCharCode(...bytes.subarray(xing, xing + 4)), 'Info');
	assert.equal(bytes[0], 255); assert.equal(bytes[1], 251); // MPEG1 mono192kbps48k.
	const tag = Buffer.from(bytes).indexOf('LAME'); assert.equal(tag, 141);
	assert.equal(new DataView(bytes.buffer).getUint16(tag + 34), reflectedCrc(bytes.subarray(0, tag + 34)));
	if (layout !== 'unprotected') {
		bytes[1] = bytes[1]! & ~1;
		if (layout === 'crc-offset') { bytes.copyWithin(xing + 2, xing, frameBytes - 2); bytes.fill(0, xing, xing + 2); }
		// LAME bitstream.c CRC_writeheader: protected header bits and17-byte side information.
		let crc = 0xffff;
		for (const byte of [...bytes.subarray(2, 4), ...bytes.subarray(6, 23)]) {
			for (let bit = 7; bit >= 0; bit--) { const high = crc >>> 15; crc = crc << 1 & 0xffff; if (high ^ (byte >>> bit & 1)) crc ^= 0x8005; }
		}
		new DataView(bytes.buffer).setUint16(4, crc);
		// LAME VbrTag.c: reflected CRC16 covers the complete tag before its final two bytes.
		const end = tag + (layout === 'crc-offset' ? 2 : 0) + 34;
		new DataView(bytes.buffer).setUint16(end, reflectedCrc(bytes.subarray(0, end)));
	}
	assert.deepEqual(bytes.subarray(frameBytes), original.subarray(frameBytes));
	return new File([bytes], `CRC-${layout}.mp3`, { type: 'audio/mpeg' });
}

function reflectedCrc(bytes: Uint8Array): number {
	let crc = 0;
	for (const byte of bytes) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = crc >>> 1 ^ (crc & 1 ? 0xa001 : 0); }
	return crc;
}

/** APEv2 binary items may hold an encoded preview, outside the MPEG programme. */
export async function apePreviewMp3Fixture(header = true, legacy = false, binary = true): Promise<File> {
	const audio = await ordinaryMp3Pcm();
	const value = binary ? audio : new TextEncoder().encode('Reviewed programme');
	const item = Buffer.concat([Buffer.alloc(8), Buffer.from('Embedded Preview\0'), value]);
	item.writeUInt32LE(value.length, 0); item.writeUInt32LE(binary ? 2 : 0, 4);
	const record = (isHeader: boolean): Uint8Array<ArrayBuffer> => {
		const bytes = new Uint8Array(32); bytes.set(new TextEncoder().encode('APETAGEX'));
		const view = new DataView(bytes.buffer); view.setUint32(8, 2000, true);
		view.setUint32(12, item.length + 32, true); view.setUint32(16, 1, true);
		view.setUint32(20, (header ? 0x80000000 : 0) + (isHeader ? 0x20000000 : 0), true);
		return bytes;
	};
	const id3 = new Uint8Array(legacy ? 128 : 0); if (legacy) id3.set([84, 65, 71]);
	return new File([audio, ...(header ? [record(true)] : []), item, record(false), id3], 'APE preview.mp3', { type: 'audio/mpeg' });
}
