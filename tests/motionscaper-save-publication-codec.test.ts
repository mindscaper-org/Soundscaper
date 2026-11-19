/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';
import { motionSaveJournalPath, readMotionSaveJournal, writeMotionSaveJournal } from '../desktop/motion-save-publication-journal.ts';
import { decodeMotionSaveJournal, encodeMotionSaveJournal, type MotionSaveJournal } from '../desktop/motion-save-publication-codec.ts';

const legacy = {
	format: 'motionscaper-save-publication', version: 1,
	transactionId: '00000000-0000-4000-8000-000000000001', projectId: 'motion-project', phase: 'pending',
	candidate: { dev: 42, ino: 17, size: 7, mtimeMs: 1700000000000.25, ctimeMs: 1700000000000.5 },
	sha256: 'a'.repeat(64), previous: null, backup: null, previousSha256: null,
} as const;
// The old v1 writer's seal is fixed independently of the new codec.
const legacyChecksum = '14e5873b3aded7bcbf539ccade7b7404f1fbea475b74dd806445cc5b0bd13240';
const modern: MotionSaveJournal = {
	...legacy, version: 2,
	candidate: { ...legacy.candidate, dev: '2731094893', ino: '17169973583882990' },
	previous: { ...legacy.candidate, dev: '2731094893', ino: '17169973583882991' },
	backup: { ...legacy.candidate, dev: '2731094893', ino: '17169973583882992' },
	previousSha256: 'b'.repeat(64),
};
function sealed(journal: unknown) {
	return { journal, checksum: createHash('sha256').update(JSON.stringify(journal)).digest('hex') };
}
async function fixture(context: TestContext, envelope: unknown) {
	const directory = await mkdtemp(join(tmpdir(), 'motion-journal-codec-')), path = join(directory, 'saved.mscape');
	context.after(async () => { await rm(directory, { recursive: true, force: true }); });
	await writeFile(motionSaveJournalPath(path), JSON.stringify(envelope), { flag: 'wx' });
	return path;
}

test('A valid legacy v1 seal is checked before migrating its numeric identities to runtime v2', async context => {
	assert.equal(sealed(legacy).checksum, legacyChecksum);
	const path = await fixture(context, { journal: legacy, checksum: legacyChecksum });
	const result = await readMotionSaveJournal(path); assert.ok(result);
	assert.equal(result.checksum, legacyChecksum);
	assert.deepEqual(result.journal, { ...legacy, version: 2, candidate: { ...legacy.candidate, dev: '42', ino: '17' } });
});

test('A legacy journal keeps its original CAS checksum while its next phase is written as lossless v2', async context => {
	const path = await fixture(context, { journal: legacy, checksum: legacyChecksum });
	const prior = await readMotionSaveJournal(path); assert.ok(prior);
	await writeMotionSaveJournal(path, { ...prior.journal, phase: 'published' }, prior.checksum);
	const raw = JSON.parse(await readFile(motionSaveJournalPath(path), 'utf8')) as { journal: { version: number; candidate: { dev: unknown; ino: unknown } }; checksum: string };
	assert.equal(raw.journal.version, 2); assert.equal(raw.journal.candidate.dev, '42'); assert.equal(raw.journal.candidate.ino, '17');
	assert.notEqual(raw.checksum, legacyChecksum);
	const next = await readMotionSaveJournal(path); assert.ok(next);
	assert.equal(next.journal.phase, 'published'); assert.equal(next.checksum, raw.checksum);
});

test('V2 retains exact candidate, previous and backup NTFS identities that collide when converted to Number', async context => {
	assert.ok(modern.previous && modern.backup);
	assert.equal(Number(modern.previous.ino), Number(modern.backup.ino));
	const envelope = sealed(modern), path = await fixture(context, envelope);
	const result = await readMotionSaveJournal(path); assert.ok(result);
	assert.deepEqual(result.journal, modern); assert.equal(result.checksum, envelope.checksum);
	assert.notEqual(result.journal.previous?.ino, result.journal.backup?.ino);
});

test('Legacy checksum normalization preserves the old supported field ordering', async context => {
	const reordered = Object.fromEntries(Object.entries(legacy).reverse());
	const path = await fixture(context, { journal: reordered, checksum: legacyChecksum });
	const result = await readMotionSaveJournal(path); assert.ok(result);
	assert.equal(result.journal.version, 2); assert.equal(result.journal.candidate.ino, '17');
	assert.equal(result.checksum, legacyChecksum);
});

for (const field of ['dev', 'ino'] as const) {
	test(`Legacy unsafe numeric ${field} is refused even with a correct seal`, async context => {
		const value = { ...legacy, candidate: { ...legacy.candidate, [field]: Number.MAX_SAFE_INTEGER + 1 } };
		await assert.rejects(readMotionSaveJournal(await fixture(context, sealed(value))));
	});
}

test('V1 cannot silently admit the v2 string identity representation', async context => {
	const value = { ...legacy, candidate: { ...legacy.candidate, ino: '17' } };
	await assert.rejects(readMotionSaveJournal(await fixture(context, sealed(value))));
});

for (const identity of ['017', '-1', '18446744073709551616', '1e3', 17]) {
	test(`V2 refuses noncanonical or wrongly typed inode ${String(identity)}`, async context => {
		const value = { ...modern, candidate: { ...modern.candidate, ino: identity } };
		await assert.rejects(readMotionSaveJournal(await fixture(context, sealed(value))));
	});
}

test('A v2 identity change cannot retain the previous checksum', async context => {
	const envelope = sealed(modern);
	const path = await fixture(context, { ...envelope, journal: { ...modern, candidate: { ...modern.candidate, ino: '17169973583882991' } } });
	await assert.rejects(readMotionSaveJournal(path), /checksum/u);
});

test('Version migration does not admit foreign fields, unsupported versions or incomplete backups', async context => {
	for (const value of [{ ...modern, version: 3 }, { ...modern, extra: true }, { ...modern, backup: null }]) {
		await assert.rejects(readMotionSaveJournal(await fixture(context, sealed(value))));
	}
});

test('The codec seals canonical v2 without changing exact identities or fractional timestamps', () => {
	const encoded = encodeMotionSaveJournal(modern);
	assert.deepEqual(encoded, sealed(modern)); assert.deepEqual(decodeMotionSaveJournal(encoded), encoded);
	assert.equal(encoded.journal.candidate.mtimeMs, 1700000000000.25);
	assert.equal(encoded.journal.candidate.ctimeMs, 1700000000000.5);
});

test('Migrating a legacy seal cannot authorize the different v2 wire representation', () => {
	const migrated = decodeMotionSaveJournal({ journal: legacy, checksum: legacyChecksum });
	const encoded = encodeMotionSaveJournal(migrated.journal);
	assert.equal(migrated.checksum, legacyChecksum); assert.notEqual(encoded.checksum, legacyChecksum);
	assert.throws(() => decodeMotionSaveJournal({ journal: encoded.journal, checksum: legacyChecksum }), /checksum/u);
});

test('The writer refuses legacy or malformed caller objects instead of producing an unreadable journal', () => {
	for (const value of [legacy, { ...modern, extra: true }, { ...modern, backup: null },
		{ ...modern, candidate: { ...modern.candidate, ino: Number.MAX_SAFE_INTEGER + 1 } }]) {
		assert.throws(() => encodeMotionSaveJournal(value as unknown as MotionSaveJournal));
	}
});

test('V2 accepts unsigned 64-bit identity endpoints without reducing them to Number', () => {
	const journal = { ...modern, candidate: { ...modern.candidate, dev: '0', ino: '18446744073709551615' } };
	assert.deepEqual(decodeMotionSaveJournal(encodeMotionSaveJournal(journal)).journal, journal);
});

test('Journal identity migration preserves its 64 GiB byte bound and finite nonnegative timestamps', () => {
	const maximum = 64 * 1024 ** 3;
	assert.equal(encodeMotionSaveJournal({ ...modern, candidate: { ...modern.candidate, size: maximum } }).journal.candidate.size, maximum);
	for (const changed of [{ size: maximum + 1 }, { size: 0.5 }, { size: -1 }, { mtimeMs: Infinity }, { ctimeMs: NaN }, { mtimeMs: -1 }]) {
		assert.throws(() => encodeMotionSaveJournal({ ...modern, candidate: { ...modern.candidate, ...changed } }));
	}
});
