/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { createAudacitySqlitePageReader } from '../src/common/editor/audacity-sqlite-page-reader.ts';
import { AUP3_SAMPLE_FORMAT, createAup3Fixture } from './aup3-fixture.js';

test('page recovery stops before a freed overflow page instead of resurrecting deleted audio', async () => {
	const directory = mkdtempSync(join(tmpdir(), 'scape-aup3-free-'));
	try {
		const source = join(directory, 'freelist.aup3');
		writeFileSync(source, await createAup3Fixture({ tracks: [{ clips: [
			{ samples: Array.from({ length: 8192 }, () => 0.25) },
			{ samples: Array.from({ length: 8192 }, () => -0.75) },
		] }] }));
		const db = new DatabaseSync(source);
		const overflow = db.prepare("SELECT pageno FROM dbstat WHERE name='sampleblocks' AND pagetype='overflow' ORDER BY pageno LIMIT 1").get();
		const root = Number(db.prepare("SELECT rootpage FROM sqlite_schema WHERE name='sampleblocks'").get()?.rootpage);
		assert.ok(overflow);
		db.exec('DELETE FROM sampleblocks WHERE blockid=2'); db.close();
		const bytes = readFileSync(source), encodedSize = bytes.readUInt16BE(16), pageSize = encodedSize === 1 ? 65536 : encodedSize;
		const freeTrunk = bytes.readUInt32BE(32), freeLeaf = bytes.readUInt32BE((freeTrunk - 1) * pageSize + 8);
		assert.ok(freeLeaf > 0);
		bytes.writeUInt32BE(freeLeaf, (Number(overflow.pageno) - 1) * pageSize);
		const raw = await createAudacitySqlitePageReader({ byteLength: bytes.length,
			read: (offset, length) => bytes.subarray(offset, offset + length) }, root);
		const recovered = await raw.readSampleBlock(1);
		assert.ok(recovered);
		assert.ok(recovered.readableBytes > 0 && recovered.readableBytes < recovered.samples.length);
		const samples = new DataView(recovered.samples.buffer, recovered.samples.byteOffset, recovered.samples.byteLength);
		for (let index = 0; index < samples.byteLength; index += 4) {
			assert.equal(samples.getFloat32(index, true), index < recovered.readableBytes ? 0.25 : 0);
		}
		assert.equal(await raw.readSampleBlock(2), null);
	} finally { rmSync(directory, { recursive: true, force: true }); }
});

for (const pageSize of [512, 65536]) test(`asynchronous page recovery preserves PCM bytes and formats with ${pageSize}-byte pages`, async () => {
	const directory = mkdtempSync(join(tmpdir(), 'scape-page-formats-'));
	try {
		const source = join(directory, 'formats.aup3');
		writeFileSync(source, await createAup3Fixture({ tracks: [{ clips: Object.values(AUP3_SAMPLE_FORMAT).map(sampleFormat => ({
			sampleFormat, samples: Array.from({ length: 8192 }, (_, index) => index % 2 ? -0.5 : 0.25),
		})) }] }));
		const database = new DatabaseSync(source);
		let originals, root;
		try {
			database.exec(`PRAGMA page_size=${pageSize}; VACUUM`);
			root = Number(database.prepare("SELECT rootpage FROM sqlite_schema WHERE name='sampleblocks'").get()?.rootpage);
			originals = database.prepare('SELECT blockid, sampleformat, samples FROM sampleblocks ORDER BY blockid').all();
		} finally { database.close(); }
		const bytes = readFileSync(source);
		let unavailable = false;
		const reader = await createAudacitySqlitePageReader({ byteLength: bytes.length, async read(offset, length) {
			await Promise.resolve();
			if (unavailable) throw new Error('source disconnected');
			return bytes.subarray(offset, offset + length);
		} }, root);
		for (const original of originals) {
			const block = await reader.readSampleBlock(Number(original.blockid));
			assert.ok(block); assert.equal(block.sampleFormat, original.sampleformat);
			assert.deepEqual(block.samples, new Uint8Array(original.samples as Uint8Array));
			assert.equal(block.readableBytes, block.samples.byteLength);
		}
		unavailable = true;
		await assert.rejects(reader.readSampleBlock(1), /source disconnected/);
	} finally { rmSync(directory, { recursive: true, force: true }); }
});

