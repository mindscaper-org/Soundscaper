/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { BlobSource, BufferTarget, EncodedAudioPacketSource, EncodedPacketSink, Input, MP4, Mp4OutputFormat, Output, type MetadataTags } from 'mediabunny';
import { aacLcM4a44_100Fixture } from './os-audio-codec-fixtures.ts';

/** Author a normal longer AAC programme, retaining its encoder's ordinary packets. */
export async function ordinaryTailM4aFixture(fastStart: false | 'in-memory' = false): Promise<File> {
	const input = new Input({ source: new BlobSource(new Blob([Uint8Array.from(aacLcM4a44_100Fixture())])), formats: [MP4] });
	try {
		const track = await input.getPrimaryAudioTrack();
		assert.ok(track);
		const decoderConfig = await track.getDecoderConfig();
		assert.ok(decoderConfig);
		const packet = await new EncodedPacketSink(track).getPacket(0);
		assert.ok(packet);
		const target = new BufferTarget();
		const output = new Output({ format: new Mp4OutputFormat({ fastStart }), target });
		const source = new EncodedAudioPacketSource('aac');
		output.addAudioTrack(source);
		await output.start();
		for (let index = 0; index < 4_000; index += 1) {
			await source.add(packet.clone({ timestamp: index * 1024 / 44_100, duration: 1024 / 44_100 }), { decoderConfig });
		}
		await output.finalize();
		assert.ok(target.buffer);
		assert.ok(target.buffer.byteLength > 1024 ** 2);
		return new File([target.buffer], 'Programme.m4a', { type: 'audio/mp4' });
	} finally { input.dispose(); }
}

/** A legal multi-value cover item from the same ordinary AAC packet stream. */
export async function multiValueM4aArtworkFixture(grouped = true, extraMetadata: MetadataTags = {}): Promise<Readonly<{ file: File; images: readonly Uint8Array<ArrayBuffer>[] }>> {
	const images = [
		Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGM4IScCAAKsAPs2xCzlAAAAAElFTkSuQmCC', 'base64')),
		Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGMQkTsBAAFEAPtKtXAbAAAAAElFTkSuQmCC', 'base64')),
	];
	const input = new Input({ source: new BlobSource(new Blob([Uint8Array.from(aacLcM4a44_100Fixture())])), formats: [MP4] });
	try {
		const track = await input.getPrimaryAudioTrack(); assert.ok(track);
		const decoderConfig = await track.getDecoderConfig(); assert.ok(decoderConfig);
		const target = new BufferTarget();
		const output = new Output({ format: new Mp4OutputFormat({ fastStart: false }), target });
		const source = new EncodedAudioPacketSource('aac'); output.addAudioTrack(source);
		output.setMetadataTags({ ...extraMetadata, title: 'Two retained covers', images: images.map(data => ({
			data, mimeType: 'image/png', kind: 'coverFront' as const,
		})), comment: 'After covers' });
		await output.start();
		let origin: number | null = null;
		for await (const packet of new EncodedPacketSink(track).packets()) {
			origin ??= packet.timestamp;
			await source.add(packet.clone({ timestamp: packet.timestamp - origin }), { decoderConfig });
		}
		await output.finalize(); assert.ok(target.buffer);
		const bytes = Buffer.from(target.buffer);
		const atoms = m4aAtoms(bytes);
		assert.ok(atoms.findIndex(atom => atom.toString('latin1', 4, 8) === 'mdat') < atoms.findIndex(atom => atom.toString('latin1', 4, 8) === 'moov'));
		const body = grouped ? mergeM4aCoverValues(bytes) : bytes;
		return { file: new File([Uint8Array.from(body)], 'Two covers.m4a', { type: 'audio/mp4' }), images };
	} finally { input.dispose(); }
}

function m4aAtoms(bytes: Buffer): Buffer[] {
	const atoms: Buffer[] = [];
	for (let offset = 0; offset < bytes.length;) {
		const length = bytes.readUInt32BE(offset);
		assert.ok(length >= 8 && offset + length <= bytes.length);
		atoms.push(bytes.subarray(offset, offset + length)); offset += length;
	}
	return atoms;
}

function mergeM4aCoverValues(bytes: Buffer): Buffer {
	const atom = (type: string, body: Buffer): Buffer => {
		const header = Buffer.alloc(8); header.writeUInt32BE(body.length + 8); header.write(type, 4, 'latin1');
		return Buffer.concat([header, body]);
	};
	return Buffer.concat(m4aAtoms(bytes).map(child => {
		const type = child.toString('latin1', 4, 8);
		if (type === 'ilst') {
			const items = m4aAtoms(child.subarray(8));
			const covers = items.filter(item => item.toString('latin1', 4, 8) === 'covr');
			assert.equal(covers.length, 2);
			const firstCover = items.indexOf(covers[0]!);
			return atom(type, Buffer.concat(items.flatMap((item, index) => item.toString('latin1', 4, 8) !== 'covr'
				? [item] : index === firstCover ? [atom('covr', Buffer.concat(covers.map(cover => cover.subarray(8))))] : [])));
		}
		if (['moov', 'udta', 'meta'].includes(type)) {
			const prefix = type === 'meta' ? child.subarray(8, 12) : Buffer.alloc(0);
			return atom(type, Buffer.concat([prefix, mergeM4aCoverValues(child.subarray(8 + prefix.length))]));
		}
		return child;
	}));
}

/** iTunes/MP4v2 genre values use a two-byte index and the genres data class18. */
export async function iTunesGenreM4aFixture(genre: number | string, textGenre?: string): Promise<File> {
	const raw = typeof genre === 'number' ? { gnre: Uint8Array.of(genre >>> 8, genre & 255) } : undefined;
	const { file } = await multiValueM4aArtworkFixture(false, { ...(raw ? { raw } : { genre: String(genre) }),
		...(textGenre === undefined ? {} : { genre: textGenre }) });
	if (typeof genre !== 'number') return file;
	const bytes = Buffer.from(await file.arrayBuffer());
	const position = bytes.indexOf(Buffer.from('gnre'));
	assert.ok(position >= 4);
	assert.equal(bytes.indexOf(Buffer.from('gnre'), position + 1), -1);
	assert.equal(bytes.readUInt32BE(position - 4), 26);
	assert.equal(bytes.toString('latin1', position + 8, position + 12), 'data');
	bytes.writeUInt32BE(18, position + 12);
	return new File([Uint8Array.from(bytes)], 'iTunes genre.m4a', { type: file.type });
}

/** MP4v2 reverse-DNS custom fields keep their meaning, name and UTF-8 value. */
export async function freeformM4aMetadataFixture(): Promise<File> {
	const fields: Readonly<Record<string, readonly [string, string, string]>> = {
		Xfr1: ['com.apple.iTunes', 'ENGINEER', 'Hélène — reviewed credit'],
		Xfr2: ['org.example.archive', 'ENGINEER', 'Second namespace credit'],
	};
	const { file } = await multiValueM4aArtworkFixture(false, { raw: Object.fromEntries(Object.entries(fields).map(([key, field]) => [key, field[2]])) });
	const atom = (type: string, body: Buffer): Buffer => {
		const header = Buffer.alloc(8); header.writeUInt32BE(body.length + 8); header.write(type, 4, 'latin1');
		return Buffer.concat([header, body]);
	};
	const rewrite = (bytes: Buffer): Buffer => Buffer.concat(m4aAtoms(bytes).map(child => {
		const type = child.toString('latin1', 4, 8);
		const field = fields[type];
		if (field) return atom('----', Buffer.concat([atom('mean', Buffer.concat([Buffer.alloc(4), Buffer.from(field[0])])),
			atom('name', Buffer.concat([Buffer.alloc(4), Buffer.from(field[1])])), child.subarray(8)]));
		if (!['moov', 'udta', 'meta', 'ilst'].includes(type)) return child;
		const prefix = type === 'meta' ? child.subarray(8, 12) : Buffer.alloc(0);
		return atom(type, Buffer.concat([prefix, rewrite(child.subarray(8 + prefix.length))]));
	}));
	return new File([Uint8Array.from(rewrite(Buffer.from(await file.arrayBuffer())))], 'Credited programme.m4a', { type: file.type });
}

/** Apple's small international-text atoms, plus FFmpeg's payload-length variant. */
export async function quickTimeTextM4aFixture(encoding: 'macintosh' | 'utf16' | 'utf8' | 'ffmpeg' | 'ffmpeg-unlabelled', multiple = true): Promise<File> {
	const atom = (type: string, body: Buffer): Buffer => {
		const header = Buffer.alloc(8); header.writeUInt32BE(body.length + 8); header.write(type, 4, 'latin1');
		return Buffer.concat([header, body]);
	};
	const text = encoding === 'macintosh' ? Buffer.from([67, 97, 102, 0x8e])
		: encoding === 'utf16' ? Buffer.from([0xfe, 0xff, 0, 67, 0, 97, 0, 102, 0, 0xe9]) : Buffer.from('Café');
	const record = (bytes: Buffer, language: number): Buffer => {
		const header = Buffer.alloc(4); header.writeUInt16BE(bytes.length + (encoding.startsWith('ffmpeg') ? 0 : 4)); header.writeUInt16BE(language, 2);
		return Buffer.concat([header, bytes]);
	};
	const language = encoding === 'macintosh' ? 1 : encoding === 'ffmpeg-unlabelled' ? 0 : (5 << 10) | (14 << 5) | 7; // French Macintosh or ISO eng.
	const title = atom('©nam', Buffer.concat([record(text, language), ...(multiple ? [record(Buffer.from('Second title'), 0x15c7)] : [])]));
	const comment = atom('©cmt', record(Buffer.from('After title'), 0x15c7));
	const input = Buffer.from(await (await multiValueM4aArtworkFixture()).file.arrayBuffer());
	return new File([Uint8Array.from(Buffer.concat(m4aAtoms(input).map(child => child.toString('latin1', 4, 8) === 'moov'
		? atom('moov', Buffer.concat([...m4aAtoms(child.subarray(8)).filter(box => box.toString('latin1', 4, 8) !== 'udta'), atom('udta', Buffer.concat([title, comment]))])) : child)))],
	`QuickTime-${encoding}.m4a`, { type: 'audio/mp4' });
}

/** Modern QuickTime metadata overrides matching legacy user data in either physical order. */
export async function quickTimeMetadataPrecedenceFixture(legacyFirst: boolean): Promise<File> {
	const { file } = await multiValueM4aArtworkFixture();
	const atom = (type: string, body: Buffer): Buffer => {
		const header = Buffer.alloc(8); header.writeUInt32BE(body.length + 8); header.write(type, 4, 'latin1');
		return Buffer.concat([header, body]);
	};
	const text = (type: string, value: string): Buffer => {
		const bytes = Buffer.from(value); const header = Buffer.alloc(4);
		header.writeUInt16BE(bytes.length); header.writeUInt16BE(0x15c7, 2);
		return atom(type, Buffer.concat([header, bytes]));
	};
	const legacy = atom('udta', Buffer.concat([text('©nam', 'Old compatibility title'), text('©alb', 'Legacy album fallback')]));
	const bytes = Buffer.from(await file.arrayBuffer());
	return new File([Uint8Array.from(Buffer.concat(m4aAtoms(bytes).map(child => child.toString('latin1', 4, 8) === 'moov'
		? atom('moov', Buffer.concat(legacyFirst ? [legacy, child.subarray(8)] : [child.subarray(8), legacy])) : child)))],
	'Updated metadata.m4a', { type: 'audio/mp4' });
}

/** Exercise the application's exact AAC metadata adapter with ordinary encoded audio packets. */
export async function appMetadataM4aFixture(metadata: Readonly<Record<string, string>>): Promise<File> {
	const { browserAacMetadataFormat, browserAacMetadataTags } = await import('../../src/common/editor/browser-aac-metadata.ts');
	const input = new Input({ source: new BlobSource(new Blob([Uint8Array.from(aacLcM4a44_100Fixture())])), formats: [MP4] });
	try {
		const track = await input.getPrimaryAudioTrack(); assert.ok(track);
		const decoderConfig = await track.getDecoderConfig(); assert.ok(decoderConfig);
		const target = new BufferTarget();
		const output = new Output({ format: new Mp4OutputFormat({ fastStart: false, metadataFormat: browserAacMetadataFormat(metadata) }), target });
		const source = new EncodedAudioPacketSource('aac'); output.addAudioTrack(source);
		output.setMetadataTags(browserAacMetadataTags(metadata)); await output.start();
		let origin: number | null = null;
		for await (const packet of new EncodedPacketSink(track).packets()) {
			origin ??= packet.timestamp; await source.add(packet.clone({ timestamp: packet.timestamp - origin }), { decoderConfig });
		}
		await output.finalize(); assert.ok(target.buffer);
		return new File([target.buffer], 'Custom credits.m4a', { type: 'audio/mp4' });
	} finally { input.dispose(); }
}

/** A QuickTime presentation edit retains compressed media outside the selected programme. */
export async function editedM4aFixture(mode: 'none' | 'trim' | 'offset' | 'empty-first' | 'all-empty' | 'multiple' | 'rate' | 'version1' = 'trim'): Promise<Readonly<{ file: File; durationSeconds: number }>> {
	const { file } = await multiValueM4aArtworkFixture();
	const atom = (type: string, body: Buffer): Buffer => {
		const header = Buffer.alloc(8); header.writeUInt32BE(body.length + 8); header.write(type, 4, 'latin1');
		return Buffer.concat([header, body]);
	};
	let durationSeconds = 0;
	const rewritten = Buffer.concat(m4aAtoms(Buffer.from(await file.arrayBuffer())).map(child => {
		if (child.toString('latin1', 4, 8) !== 'moov') return child;
		const children = m4aAtoms(child.subarray(8));
		const movie = children.find(box => box.toString('latin1', 4, 8) === 'mvhd'); assert.ok(movie);
		const timescale = movie.readUInt32BE(20);
		const duration = mode === 'none' ? movie.readUInt32BE(24) : Math.floor(movie.readUInt32BE(24) / 2);
		durationSeconds = duration / timescale;
		movie.writeUInt32BE(duration * (mode === 'empty-first' || mode === 'multiple' ? 2 : 1), 24);
		return atom('moov', Buffer.concat(children.map(track => {
			if (track.toString('latin1', 4, 8) !== 'trak') return track;
			const fields = m4aAtoms(track.subarray(8)).filter(box => box.toString('latin1', 4, 8) !== 'edts');
			const header = fields.find(box => box.toString('latin1', 4, 8) === 'tkhd'); assert.ok(header);
			header.writeUInt32BE(movie.readUInt32BE(24), 28);
			if (mode === 'none') return atom('trak', Buffer.concat(fields));
			const media = fields.find(box => box.toString('latin1', 4, 8) === 'mdia'); assert.ok(media);
			const mediaHeader = m4aAtoms(media.subarray(8)).find(box => box.toString('latin1', 4, 8) === 'mdhd'); assert.ok(mediaHeader);
			const offset = mode === 'offset' ? Math.round(durationSeconds * mediaHeader.readUInt32BE(20)) : 0;
			const entries = mode === 'empty-first' ? [-1, 0] : mode === 'all-empty' ? [-1] : mode === 'multiple' ? [0, 0] : [offset];
			const version1 = mode === 'version1'; const width = version1 ? 20 : 12;
			const list = Buffer.alloc(8 + entries.length * width); list[0] = version1 ? 1 : 0; list.writeUInt32BE(entries.length, 4);
			for (const [index, start] of entries.entries()) {
				const position = 8 + index * width;
				if (version1) { list.writeBigUInt64BE(BigInt(duration), position); list.writeBigInt64BE(BigInt(start), position + 8); }
				else { list.writeUInt32BE(duration, position); list.writeInt32BE(start, position + 4); }
				list.writeUInt32BE(mode === 'rate' ? 131072 : 65536, position + width - 4);
			}
			return atom('trak', Buffer.concat([atom('edts', atom('elst', list)), ...fields]));
		})));
	}));
	return { file: new File([Uint8Array.from(rewritten)], `Presentation-${mode}.m4a`, { type: 'audio/mp4' }), durationSeconds };
}

/** QuickTime container children are unordered apart from the handler precedence. */
export async function metadataKeyOrderM4aFixture(keysFirst = false): Promise<File> {
	const file = await appMetadataM4aFixture({ title: 'Keyed programme title', artist: 'Keyed performer', engineer: 'Retained engineering credit' });
	const atom = (type: string, body: Buffer): Buffer => {
		const header = Buffer.alloc(8); header.writeUInt32BE(body.length + 8); header.write(type, 4, 'latin1');
		return Buffer.concat([header, body]);
	};
	const rewrite = (bytes: Buffer): Buffer => Buffer.concat(m4aAtoms(bytes).map(child => {
		const type = child.toString('latin1', 4, 8);
		if (type === 'meta') {
			const prefix = child.subarray(8, child.readUInt32BE(8) === 0 ? 12 : 8); const fields = m4aAtoms(child.subarray(8 + prefix.length));
			const keys = fields.find(field => field.toString('latin1', 4, 8) === 'keys'); assert.ok(keys);
			const list = fields.find(field => field.toString('latin1', 4, 8) === 'ilst'); assert.ok(list);
			const rest = fields.filter(field => !['keys', 'ilst'].includes(field.toString('latin1', 4, 8)));
			return atom(type, Buffer.concat([prefix, ...rest, ...(keysFirst ? [keys, list] : [list, keys])]));
		}
		return ['moov', 'udta'].includes(type) ? atom(type, rewrite(child.subarray(8))) : child;
	}));
	return new File([Uint8Array.from(rewrite(Buffer.from(await file.arrayBuffer())))], 'Keyed programme.m4a', { type: file.type });
}
