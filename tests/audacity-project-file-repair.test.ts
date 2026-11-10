/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { repairAudacityProjectFile } from '../desktop/audacity-project-file-repair.ts';
import { createAudacitySqlitePageReader } from '../desktop/audacity-sqlite-page-reader.ts';
import { AUP3_SAMPLE_FORMAT, createAup3Fixture } from './aup3-fixture.js';

test('offline AUP3 repair rebuilds corrupt overflow chains and summaries without changing the source or timeline', async () => {
	const directory = mkdtempSync(join(tmpdir(), 'scape-aup3-repair-'));
	try {
		const source = join(directory, 'damaged.aup3'), output = join(directory, 'repaired.aup3');
		writeFileSync(source, await createAup3Fixture({ tracks: [{ name: 'Original track', clips: [
			{ offset: 2, samples: Array.from({ length: 8192 }, (_, index) => index % 2 ? -0.5 : 0.25) },
			{ offset: 8, samples: [0.75, -0.25] },
		] }] }));
		const db = new DatabaseSync(source);
		const overflow = db.prepare("SELECT pageno FROM dbstat WHERE name = 'sampleblocks' AND pagetype = 'overflow' ORDER BY pageno LIMIT 1").get();
		assert.ok(overflow);
		const originalDocument = db.prepare('SELECT dict, doc FROM project').get();
		db.close();
		const damaged = readFileSync(source);
		const pageSize = damaged.readUInt16BE(16) || 65536;
		// Terminate a real SQLite overflow chain early; the prefix remains authentic.
		damaged.writeUInt32BE(0, (Number(overflow.pageno) - 1) * pageSize);
		writeFileSync(source, damaged);
		const report = repairAudacityProjectFile(source, output);
		assert.deepEqual(readFileSync(source), damaged);
		assert.equal(report.blocks, 2);
		assert.equal(report.losses.length, 1);
		assert.equal(report.losses[0]?.blockId, 1);
		assert.ok(report.losses[0]!.preservedFrames > 0);
		assert.ok(report.losses[0]!.silentFrames > 0);
		assert.equal(report.losses[0]?.locations[0]?.trackName, 'Original track');
		assert.equal(report.losses[0]?.locations[0]?.clipOffsetSeconds, 2);
		const repaired = new DatabaseSync(output, { readOnly: true });
		try {
			// Audacity opens a reader transaction before configuring its primary
			// connection for WAL. A DELETE-mode publication fails that handshake.
			repaired.exec('BEGIN');
			assert.equal(repaired.prepare('SELECT count(*) AS count FROM project').get()?.count, 1);
			const primary = new DatabaseSync(output);
			try { primary.exec('PRAGMA journal_mode=WAL'); } finally { primary.close(); }
			assert.equal(repaired.prepare('PRAGMA integrity_check').get()?.integrity_check, 'ok');
			assert.deepEqual(repaired.prepare('SELECT dict, doc FROM project').get(), originalDocument);
			const row = repaired.prepare('SELECT samples, summin, summax, sumrms FROM sampleblocks WHERE blockid = 1').get();
			assert.ok(row?.samples instanceof Uint8Array);
			const samples = new DataView(row.samples.buffer, row.samples.byteOffset, row.samples.byteLength);
			assert.equal(samples.byteLength, 8192 * 4);
			for (let index = 0; index < 8192; index++) {
				assert.equal(samples.getFloat32(index * 4, true), index < report.losses[0]!.preservedFrames ? index % 2 ? -0.5 : 0.25 : 0);
			}
			assert.equal(row.summin, -0.5); assert.equal(row.summax, 0.25);
			assert.ok(Number.isFinite(row.sumrms));
			assert.deepEqual(repaired.prepare('SELECT samples FROM sampleblocks WHERE blockid = 2').get()?.samples,
				new Uint8Array(Float32Array.of(0.75, -0.25).buffer));
		} finally { repaired.close(); }
		assert.throws(() => repairAudacityProjectFile(source, source), /exist|same|original/i);
		assert.throws(() => repairAudacityProjectFile(source, output), /exist/i);
	} finally { rmSync(directory, { recursive: true, force: true }); }
});

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
		const bytes = readFileSync(source), pageSize = bytes.readUInt16BE(16) || 65536;
		const freeTrunk = bytes.readUInt32BE(32), freeLeaf = bytes.readUInt32BE((freeTrunk - 1) * pageSize + 8);
		assert.ok(freeLeaf > 0);
		bytes.writeUInt32BE(freeLeaf, (Number(overflow.pageno) - 1) * pageSize);
		const raw = createAudacitySqlitePageReader({ byteLength: bytes.length,
			read: (offset, length) => bytes.subarray(offset, offset + length) }, root);
		const recovered = raw.readSampleBlock(1);
		assert.ok(recovered);
		assert.ok(recovered.readableBytes > 0 && recovered.readableBytes < recovered.samples.length);
		const samples = new DataView(recovered.samples.buffer, recovered.samples.byteOffset, recovered.samples.byteLength);
		for (let index = 0; index < samples.byteLength; index += 4) {
			assert.equal(samples.getFloat32(index, true), index < recovered.readableBytes ? 0.25 : 0);
		}
		assert.equal(raw.readSampleBlock(2), null);
	} finally { rmSync(directory, { recursive: true, force: true }); }
});

test('offline repair refuses journals, cleans failed staging, and handles large documents without importing editor state', async () => {
	const directory = mkdtempSync(join(tmpdir(), 'scape-aup3-large-'));
	try {
		const source = join(directory, 'large.aup3'), output = join(directory, 'repaired.aup3');
		writeFileSync(source, await createAup3Fixture({ tracks: [{ clips: Array.from({ length: 771 }, (_, index) => (
			{ offset: index * 2, samples: [0.25, -0.5] }
		)) }] }));
		writeFileSync(source + '-wal', 'retained journal');
		assert.throws(() => repairAudacityProjectFile(source, output), /journal|WAL/);
		rmSync(source + '-wal');
		assert.throws(() => repairAudacityProjectFile(source, output, () => { throw new Error('injected interruption'); }), /injected interruption/);
		assert.equal(existsSync(output), false);
		assert.deepEqual(readdirSync(directory), ['large.aup3']);
		const report = repairAudacityProjectFile(source, output);
		assert.equal(report.blocks, 771); assert.deepEqual(report.losses, []);
	} finally { rmSync(directory, { recursive: true, force: true }); }
});

test('offline repair reads 64 KiB pages, preserves integer PCM bits, and reports nonfinite float substitutions', async () => {
	const directory = mkdtempSync(join(tmpdir(), 'scape-aup3-formats-'));
	try {
		const source = join(directory, 'formats.aup3'), output = join(directory, 'repaired.aup3');
		writeFileSync(source, await createAup3Fixture({ tracks: [{ clips: [
			{ sampleFormat: AUP3_SAMPLE_FORMAT.INT16, samples: [0.25, -0.5, 0.75] },
			{ sampleFormat: AUP3_SAMPLE_FORMAT.INT24, samples: [0.5, -0.25, -0.75] },
			{ samples: [1, 0, -0.5] },
		] }] }));
		const db = new DatabaseSync(source);
		db.exec("PRAGMA page_size=65536; VACUUM; UPDATE sampleblocks SET samples=x'0000803f0000c07f000000bf' WHERE blockid=3");
		const originals = db.prepare('SELECT blockid, sampleformat, samples FROM sampleblocks WHERE blockid<3 ORDER BY blockid').all();
		db.close();
		const report = repairAudacityProjectFile(source, output);
		assert.equal(report.journalMode, 'wal');
		assert.equal(report.losses.length, 1);
		assert.equal(report.losses[0]?.nonFiniteSamples, 1);
		const repaired = new DatabaseSync(output, { readOnly: true });
		try {
			assert.deepEqual(repaired.prepare('SELECT blockid, sampleformat, samples FROM sampleblocks WHERE blockid<3 ORDER BY blockid').all(), originals);
			assert.deepEqual(repaired.prepare('SELECT samples FROM sampleblocks WHERE blockid=3').get()?.samples,
				new Uint8Array(Float32Array.of(1, 0, -0.5).buffer));
		} finally { repaired.close(); }
	} finally { rmSync(directory, { recursive: true, force: true }); }
});

test('offline repair replaces missing blocks with exact silence and selects a saved document after a broken autosave', async () => {
	const directory = mkdtempSync(join(tmpdir(), 'scape-aup3-missing-'));
	try {
		const source = join(directory, 'missing.aup3'), output = join(directory, 'repaired.aup3');
		writeFileSync(source, await createAup3Fixture({ autosave: true, tracks: [{ clips: [{ offset: 3,
			blocks: [{ id: 1, samples: [0.25] }, { id: 2, samples: [0.5, 0.75], missing: true }],
		}] }] }));
		const db = new DatabaseSync(source);
		db.exec("UPDATE autosave SET doc = x'ff'"); db.close();
		const report = repairAudacityProjectFile(source, output);
		assert.equal(report.documentSource, 'project');
		assert.deepEqual(report.losses.map(({ blockId, silentFrames }) => ({ blockId, silentFrames })), [{ blockId: 2, silentFrames: 2 }]);
		const repaired = new DatabaseSync(output, { readOnly: true });
		assert.equal(repaired.prepare('SELECT count(*) AS count FROM autosave').get()?.count, 0);
		assert.deepEqual(repaired.prepare('SELECT samples FROM sampleblocks WHERE blockid = 2').get()?.samples, new Uint8Array(8));
		repaired.close();
	} finally { rmSync(directory, { recursive: true, force: true }); }
});
