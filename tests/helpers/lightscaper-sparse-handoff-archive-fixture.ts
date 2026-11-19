/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { openAsBlob } from 'node:fs';
import { open, type FileHandle } from 'node:fs/promises';
import { crc32 } from 'node:zlib';
import { BlobReader, Uint8ArrayWriter, ZipReader } from '@zip.js/zip.js/index-native.js';

const PCM_FRAMES = 65_536, PCM_BYTES = PCM_FRAMES * 4, PCM_ENTRY = 'media/unused-padding/audio.f32';
interface Entry { readonly name: string; readonly bytes: Uint8Array | null; readonly size: number; readonly crc: number; readonly offset: number }

/** A real stored ZIP, with canonical mono PCM chunk headers and sparse zero
 * samples. Only a 256 KiB zero plane and the tiny original archive are resident;
 * neither Blob.size nor the ZIP reader is replaced to cross admission limits. */
export async function createSparseHandoffArchive(base: Blob, path: string, pcmChunks = 1_024) {
	const reader = new ZipReader(new BlobReader(base), { useWebWorkers: false }), bodies = new Map<string, Uint8Array>();
	try {
		for (const entry of await reader.getEntries()) if (!entry.directory) {
			assert.ok(entry.uncompressedSize < 2 * 1024 * 1024, 'Only the genuine tiny archive is copied into memory.');
			bodies.set(entry.filename, await entry.getData(new Uint8ArrayWriter()));
		}
	} finally { await reader.close(); }
	const zeros = new Uint8Array(PCM_BYTES), header = Buffer.alloc(4); header.writeUInt32LE(PCM_FRAMES);
	const hash = createHash('sha256'); let pcmCrc = 0;
	for (let index = 0; index < pcmChunks; index++) {
		hash.update(header); hash.update(zeros); pcmCrc = crc32(zeros, crc32(header, pcmCrc));
	}
	const pcmSize = pcmChunks * (4 + PCM_BYTES), pcmSha256 = hash.digest('hex');
	const manifest = JSON.parse(new TextDecoder().decode(bodies.get('manifest.json'))) as { assets: unknown[] };
	manifest.assets.push({ sourceId: 'unused-padding', kind: 'audio', encoding: 'audio-f32le-chunks-v1',
		entry: PCM_ENTRY, size: pcmSize, sha256: pcmSha256 });
	bodies.set('manifest.json', new TextEncoder().encode(JSON.stringify(manifest)));
	const file = await open(path, 'wx'), entries: Entry[] = []; let cursor = 0;
	try {
		for (const [name, bytes] of [...bodies, [PCM_ENTRY, null] as const]) {
			const entry: Entry = { name, bytes, size: bytes?.byteLength ?? pcmSize, crc: bytes ? crc32(bytes) : pcmCrc, offset: cursor };
			entries.push(entry); const nameBytes = Buffer.from(name), local = Buffer.alloc(30 + nameBytes.length);
			local.writeUInt32LE(0x04034b50); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0800, 6); local.writeUInt16LE(0x21, 12);
			local.writeUInt32LE(entry.crc, 14); local.writeUInt32LE(entry.size, 18); local.writeUInt32LE(entry.size, 22);
			local.writeUInt16LE(nameBytes.length, 26); local.set(nameBytes, 30); await write(file, local, cursor); cursor += local.length;
			if (bytes) { await write(file, bytes, cursor); cursor += bytes.length; }
			else for (let index = 0; index < pcmChunks; index++) { await write(file, header, cursor); cursor += 4 + PCM_BYTES; }
		}
		const centralOffset = cursor;
		for (const entry of entries) {
			const name = Buffer.from(entry.name), central = Buffer.alloc(46 + name.length);
			central.writeUInt32LE(0x02014b50); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6);
			central.writeUInt16LE(0x0800, 8); central.writeUInt16LE(0x21, 14); central.writeUInt32LE(entry.crc, 16);
			central.writeUInt32LE(entry.size, 20); central.writeUInt32LE(entry.size, 24); central.writeUInt16LE(name.length, 28);
			central.writeUInt32LE(entry.offset, 42); central.set(name, 46); await write(file, central, cursor); cursor += central.length;
		}
		const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
		end.writeUInt32LE(cursor - centralOffset, 12); end.writeUInt32LE(centralOffset, 16); await write(file, end, cursor);
	} finally { await file.close(); }
	return { archive: await openAsBlob(path, { type: 'application/zip' }), pcmSize, pcmSha256,
		async verifyPadding() {
			const zip = new ZipReader(new BlobReader(await openAsBlob(path)), { useWebWorkers: false });
			try {
				const entry = (await zip.getEntries()).find(value => value.filename === PCM_ENTRY); assert.ok(entry && !entry.directory);
				let received = 0; const digest = createHash('sha256');
				await entry.getData(new WritableStream<Uint8Array>({ write(chunk) { received += chunk.length; digest.update(chunk); } }), { checkSignature: true });
				assert.equal(received, pcmSize); assert.equal(digest.digest('hex'), pcmSha256);
			} finally { await zip.close(); }
		} };
}

async function write(file: FileHandle, bytes: Uint8Array, position: number): Promise<void> {
	let offset = 0;
	while (offset < bytes.length) {
		const result = await file.write(bytes, offset, bytes.length - offset, position + offset);
		if (!result.bytesWritten) throw new Error('Sparse ZIP fixture write made no progress.');
		offset += result.bytesWritten;
	}
}
