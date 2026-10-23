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

/** Native libmp3lame3.100 free_format=1,192kbps,48k mono;4800 authored sine frames. */
export function freeFormatMp3Fixture(): File {
	return new File([Uint8Array.from(Buffer.from([
		'//sExAAAAAAAAAAAAAAAAAAAAAAASW5mbwAAAA8AAAAGAAAPwAACBQcKDA8RFBYZHB4hIyYoKy0wMzU4Oj0/QkRHSUxPUVRWWVteYGNmaGttcHJ1d3p8f4KE',
		'h4mMjpGTlpmbnqCjpaiqra+ytbe6vL/BxMbJzM7R09bY293g4uXo6u3v8vT3+fwAAAA6TEFNRTMuMTAwAc0AAAAAAAAAABTAJAYAgQAAwAAAD8AI+vm0AAAA',
		'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
		'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
		'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
		'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
		'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA//sExAAAGTmBHnXHgAOas+EDP1AAAUrjcNsrkz2EzJyqN2Rg5ZLDjD4NoKQzwVDHAeMOgsBA',
		'cwGBzBYNMFgkwOAwMA0Aam4uA9Amgmgmg9BODoUCvV6Hoeh6Hq9/HpAePHjx5TXu/fv38feI+4Dx48pmG8eave+IDIr2ePv3vd+8iUpSlIDx+/ve9379+yPH',
		'jx48ePHjO/fv379+/fvHkSlKUgPH7+Pe97w47x5EpSlIER+/ve973jvHlKUpSlH8e79+/fv37x48ePHjx48fv379+/fv37x48BDB8H9HvMN660DZOBxcxhHH',
		'COXGFRjJcWC48A4JCMdeFazBKQgIwnMG/RtMMFBO/MHNBfDBYQXxrjTteBmZhga6VI5RJ4GqF+Bi8yAZnLxFSZPcDMJwAwoOwMfDsyMn4GPCSBgkSAYnEwGK',
		'RgAAF0UWSV3gYYDIGGhCAaDAMHg4DCIUAWArrXV/AwMBwMEA0LEgMBgIDAYEDAoNg3//BsKHRA3EFhQfqFwoXCibv//DFQYqGNDVogqMcILCgh0igf//8XKQ',
		'4XMOcURzSClIixPHSKnv/V/+rUXk6JxpRSUTRiiTJkXiBf/9v/V9akxBTUUzLjEwMKqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqow',
		'jUPCMKHEsjht+Q03FA+PMhSFvTEngq0wEoC+MCjAuDAwwJYwF4BvMA+AGRoAQDAAK//////////////eYFQD4GHRj0JtGXom//sExCSDx5wbBh3wAADdg2DB',
		'/uxAbSWPln+1BG26kn9Zh1Mib05GiIBl42BhRt7///u//////r////1/ur//+qpMQU1FMy4xMDCqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq',
		'qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq',
		'qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq',
		'qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq',
		'qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq',
		'qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqjCrAyUxHsgCNrM8IDayx9wxC4KdMHVBUD/rs4lWOwEKoGoiBjmS3f/////1',
		'/u/////+4wKcHzMOgHpDaJ/T//sExB8DxlAbBg/vJADdg2DB/uxAA2jwfMP9aDNtFIP7zTqJA3tzNFQTLhoDC7aXf//f//////V////q/fV//9dMQU1FMy4x',
		'MDBVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV',
		'VVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV',
		'VVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV',
		'VVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV',
		'VVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVMKtDIjEfB/82tnwD',
		'NrWH2TEMQpowdYFRP/uDiFcBtBRE1UAMaya//////+r9//////3////7jApAfQw58epNoY9T//sExCEDxsgbBg/vJADdg2DB/uxATaMR9E/yoQ21Uk/rOOpk',
		'TenI0RAMvGwMKNvf//93/////9f///+v91f//1IAABtSX6tgEmFlBTRhxw3EZmkzsGfAhCZga4IiYAaBwGBlAKhgFQBYUABq8gwAARMSAZwxBrkghs0DocFO',
		'TsesnarUg9ZC1WuC2D0EIRinANAMBLEmJODnDDL2fghYuaFthbCCEsVDGTguDJKn0PQ9zYDTZ4+Hjx5EurGSJmG/f3o/fx8QHjzV3jyYTg/B+UcUOQ/B+qUO',
		'cPyhwock4P1SgY4P7igY4fAGAQBAYDAgFAYAAAAAMABU/DDAAPcwNwBqMMZEHjAAQBJAeYo+CKmOFikJhuYSAYDgCCromTBOwR0wRMCXMEoBETA8AN2M8OmP',
		'I14rjGKENPpjWRyZPHw6ucXhJos+GFimZmM/d4m9UCd0kBvByGWieYJGxkkkfrI40lD1NNOOw832gTu0qMfjIACUxoNTFQfBoW/eP6OqUY5YnD39nOcy04mj',
		'zy1KMSiYw6EBADTDQbMJAUVAmW981o1AmjRRANpqs0ukTQI7NhJ40YhjCIQBQSQ4mCASJAFRYwGAu73zWumJgQZDGpi0VmJQOY+GBigTGIAIY5FqeTRS0rJI',
		'IRWZXG975rXd7MTiUw+AzGgoMRCIw0ADGInMQh8wyATFgiMPBxUq2JC5SdsPRlGZycea13e+a10BCwxWITDobAwrMTB4w0GAMJDEodMMhcFCMxAGjCwWBQcE',
		'//sExP+AFPC7E7X3gAdavCM3P8AAQBYc/wXAS5WshQCqZLuBoGTlVKCATvfNa7vfNa7sw+GTC4VBwfMOBYwoEgcGDDIVMJhEIC5hYJGEAgEBAwqETCIPCAmY',
		'SBxg4GBgM//////////SqSGAoKQxQCgAGoZFyjAIOQElsTAQPLnFljAoQLmlkTAwT/rGERcYRFxhFtVMQU1FMy4xMDBVVVVVVVVVVVVVVVVVVVVVVVVVVVVV',
		'VVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV',
		'VVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV',
		'VVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV',
		'VVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV',
		'VVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV//sExAADwAABpBwAACAAADSAAAAETEFNRTMuMTAwVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV',
		'VVVVVVVVVVVVVVVMQU1FMy4xMDBVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV',
		'VVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV',
		'VVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV',
		'VVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV',
		'VVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV',
		'VVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV',
	].join(''), 'base64'))], 'Free-format.mp3', { type: 'audio/mpeg' });
}

/** The same native encoder at44.1k uses both padded and unpadded MPEG frames. */
export function paddedFreeFormatMp3Fixture(): File {
	return new File([Uint8Array.from(Buffer.from([
		'//sAxAAAAAAAAAAAAAAAAAAAAAAASW5mbwAAAA8AAAAGAAARIwACBQcKDA8RFBYZHB4hIyYoKy0wMzU4Oj0/QkRHSUxPUVRWWVteYGNmaGttcHJ1d3p8f4KE',
		'h4mMjpGTlpmbnqCjpaiqra+ytbe6vL/BxMbJzM7R09bY293g4uXo6u3v8vT3+fwAAAA6TEFNRTMuMTAwAc0AAAAAAAAAABTAJAYAQQAAwAAAESPo7HaLAAAA',
		'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
		'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
		'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
		'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
		'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD/+wDE',
		'AAAddaMWVdeAC7i34QM/UAABQWNg1NM4Q1MlkyNonqODIMN7G2NckmM3igMcBGMRQlMFwTMFwhMJwpMJwjMHwZMFQPMCwHBQBgJgDoAJAAgAgAgBIBcC4GmW',
		'8g49Y9ZOzTUbO8YE4hiGKBWPNe79+/fx9++6PHlNZvEp83/pR/Hv/73fxKU16UpSPe973ve8SlKUpSlI973ve97xKRKUpSA8fv4973vDjvHkSlKUgRH7+973',
		'veO8eUpSlKUfx73ve97vHjx48ePHjx+/fv379+/fvHjx48ePHkR+/fv379+/jvHgAAAAGHh4eHgAAAAAGHh4eHgAAAAAGHh4eYb11oGycDi5jCOOEcuMKjGS',
		'4sFx4BwSEY68K1mCUhARhOYN+jaYYKCd+YOaC+GCwgvjXGna8DMzDA10qRyiTwNUL8DF5kAzOXiKkye4GYTgBhQdgY+HYGPCSZGTo+BgkSAYnEwGKRgAAFwM',
		'MBlFklPvgYaEIBoMAweDgMIhQBYCgYGA611f4GCAaFiQGAwEBgMCBgUGwaDYX//DogbiCwoP1C4ULhRNwYqDFX//4xoatEFRjhBYUEOkUCLlIcLm///8c4oj',
		'mkFKRFieOkVPKLydH+r//V/ONKKSiaMUSZMi8QIul0gJNEWHK/6//61MQU1FMy4xMDBVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV',
		'VVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVTCNQ8IwocSyOG35DTcUD48yFIW9Mf/7AsQKg8ec',
		'GwYd8AAA24Ngwf7sQCeCrTASgL4wKMC4MDDAljAXgG8wD4AZGgBAMAAr/////////////95gVAPgYdGPQm0ZeiZtJY+Wf7UEbbqSf1mHUyJvTkaIgGXjYGFG',
		'3v//+7/////+v////X/r//+pTEFNRTMuMTAwVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV',
		'VVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV',
		'VVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV',
		'VVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV',
		'VVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV',
		'VVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVUwqwMlMR7IAjazPP/7AsQFg8ZQGwYP',
		'7yQA24Ngwf7sQCA2ssfcMQuCnTB1QVA/67OJVjsBCqBqIgY5kt3/////9f7v/////uMCnB8zDoB6Q2if0wNo8HzD/WgzbRSD+806iQN7czRUEy4aAwu2l3//',
		'3//////1f///6v9X//1qTEFNRTMuMTAwqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq',
		'qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq',
		'qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq',
		'qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq',
		'qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq',
		'qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqjCrQyIxHwf/NrZ8Aza1h//7AsQHg8bIGwYP7yQA',
		'24Ngwf7sQNkxDEKaMHWBUT/7g4hXAbQURNVADGsmv//////q/f/////9////+4wKQH0MOfHqTaGPU02jEfRP8qENtVJP6zjqZE3pyNEQDLxsDCjb3///d///',
		'///X////r/1///VVAAVaWxIAAxC4PmMVOKODS/pjo1vMMdMFLBoTAIwVowToCMMBMAUCgAxQRAYAcAAAEpBrDOGuTkTJwXBwb0PNND3NSE7Lmq2wggmguCMP',
		'8QgG4ZC7G+IWLmcZ+BHxDzjXBKBbBwIw/xNC4KiVDzTOtnYCdlzVcjxWPIkNWKyJl+/fx4CvZ4+IDx5S7AyTZhv394Y/AAZAHB4+GP4AdAHRz8x/ADwAzM/M',
		'/7eAO/8z/14A7/zf/+IAHAgDAoFAwHAoCAQAACvFhj/BPmEYB8ZB5YAVACWuaPYeJsVo+mSaL4YIQU7uVTFrFJMT0K8wvgrzCYCNpeGvyMGbRlGDIoGMYvay',
		'NUi4OBWLNQ0xMVRKMBgvMPA7/8TRslzaxTDRZCDPQfjDQLQKDRhOExhCDH/3zedgTUdOTSElza5VjShHAoB5g0DZgoBYhAYwRBD+f/TVotjgFnTWlWzT8pzd',
		'JfDU5QjAsAEEJgQBIOAVMowDAL/5/9MohOM9THMrypMlxHM4i4MoicMjBAQHL5LSqwt2QDNS////8xRD8w3DUwtAsxKDowyDAwoAgxFDcwxC0wnAeCUxXUji',
		'7nbp3Jej/////8xADIwsCowiAYw7C8wrCkwhAUw2CwwmCQweAIwzCkwlCOy/zPZdSr6hnFVV2qb///////DALMEAKMCAIDAEMP/7AsT/gBbIxQ1V94APZT7j',
		'9z3QADwLMBwHDgHMDAIMBgEDgAMCwHMBQFDgDMCAGMBACTSdl/UbXCcpDJlLOUBLKmHFzmArt//////////L8GBICmAYBl+zAYAjAIAEKDAUAzAEAURzAIAA',
		'EACSBgCAJZNJMBAAWYTU//////LcsCVMFQAVtUBBgAq3JjA0AlKUVQQAalSKwJAJSlAKBAF9di7F2LVMQU1FMy4xMDBVVVVVVVVVVVVVVVVVVVVVVVVVVVVV',
		'VVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV',
		'VVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV',
		'VVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV',
		'VVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV',
		'VVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVf/7AsQAA8AAAaQcAAAgAAA0gAAA',
		'BExBTUUzLjEwMFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV',
		'VVVVVVVVTEFNRTMuMTAwVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV',
		'VVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV',
		'VVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV',
		'VVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV',
		'VVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV',
		'VVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVQ==',
	].join(''), 'base64'))], 'Padded-free-format.mp3', { type: 'audio/mpeg' });
}
