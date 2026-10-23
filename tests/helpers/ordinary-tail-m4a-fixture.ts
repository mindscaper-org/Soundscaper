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
