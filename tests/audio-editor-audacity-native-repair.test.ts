/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { repairAudacityNativeCopy } from '../src/common/editor/audacity-native-repair.ts';
import { inspectAudacityRecovery } from '../src/common/editor/audacity-recovery-inspection.ts';
import { decodeAudacityBinaryXml } from '../src/common/editor/audacity-binary-xml.js';
import { createAup3Fixture } from './aup3-fixture.js';
import { SQL } from './helpers/aup4-database-harness.js';
import { projectWithBlocks } from './helpers/aup4-database-harness.js';
import { initializeAup4Database, writeAup4Document } from '../src/common/editor/aup4-database.js';

test('inspection reports named missing ranges before repair without changing the database', async () => {
	const db = new SQL.Database(await createAup3Fixture({ tracks: [{ name: 'Voice', clips: [{ name: 'Take', offset: 2,
		blocks: [{ id: 1, samples: [0.5] }, { id: 2, samples: [0.25, 0.5], missing: true }] }] }] }));
	try {
		const before = db.export();
		const report = inspectAudacityRecovery(db);
		assert.equal(report.canRepair, true);
		assert.equal(report.integrity, 'ok');
		assert.equal(report.missing.length, 1);
		assert.equal(report.missing[0]?.track, 'Voice');
		assert.equal(report.missing[0]?.clip, 'Take');
		assert.equal(report.missing[0]?.startSeconds, 2 + 1 / 48000);
		assert.equal(report.missing[0]?.endSeconds, 2 + 3 / 48000);
		assert.deepEqual(db.export(), before);
	} finally { db.close(); }
});

test('native repair patches only missing block IDs and preserves dictionaries, saved rows and history', async () => {
	const db = new SQL.Database(await createAup3Fixture({ autosave: true, tracks: [{ clips: [{
		blocks: [{ id: 1, samples: [0.5] }, { id: 2, samples: [0.25, 0.5], missing: true }] }] }] }));
	try {
		const saved = db.exec('SELECT dict, doc FROM project')[0]!.values[0]!;
		const original = db.exec('SELECT dict, doc FROM autosave')[0]!.values[0]!;
		const result = repairAudacityNativeCopy(db);
		assert.equal(result.repairedReferences, 1);
		assert.deepEqual(db.exec('SELECT dict, doc FROM project')[0]!.values[0], saved);
		const repaired = db.exec('SELECT dict, doc FROM autosave')[0]!.values[0]!;
		assert.deepEqual(repaired[0], original[0]);
		const oldDoc = original[1] as Uint8Array, newDoc = repaired[1] as Uint8Array;
		assert.equal(newDoc.length, oldDoc.length);
		const tokens = decodeAudacityBinaryXml(repaired[0], newDoc).documentTokens as Array<{ name?: string; value?: unknown }>;
		assert.equal(tokens.find((entry: { name?: string; value?: unknown }) => entry.name === 'blockid' && Number(entry.value) < 0)?.value, -2);
		assert.equal(inspectAudacityRecovery(db).missing.length, 0);
		assert.ok(newDoc.filter((byte, index) => byte !== oldDoc[index]).length <= 4);
	} finally { db.close(); }
});

test('native repair refuses truncated PCM and corrupt active documents without modifying input', async () => {
	for (const sql of ['UPDATE sampleblocks SET samples = x\'00\'', 'UPDATE project SET doc = x\'ff\'']) {
		const db = new SQL.Database(await createAup3Fixture());
		try {
			db.run(sql);
			const before = db.export();
			assert.throws(() => repairAudacityNativeCopy(db));
			assert.deepEqual(db.export(), before);
		} finally { db.close(); }
	}
});

test('native AUP4 repair retains saved history while silencing the active document', () => {
	const db = new SQL.Database();
	try {
		initializeAup4Database(db);
		writeAup4Document(db, projectWithBlocks(9, 4), { autosave: false });
		writeAup4Document(db, projectWithBlocks(10, 6));
		const saved = db.exec('SELECT dict, doc FROM project')[0]!.values;
		const history = db.exec('SELECT generation, dict, doc FROM project_history ORDER BY generation')[0]!.values;
		const original = db.exec('SELECT dict, doc FROM autosave')[0]!.values[0]!;
		assert.equal(repairAudacityNativeCopy(db).repairedReferences, 1);
		assert.deepEqual(db.exec('SELECT dict, doc FROM project')[0]!.values, saved);
		assert.deepEqual(db.exec('SELECT generation, dict, doc FROM project_history ORDER BY generation')[0]!.values, history);
		const repaired = db.exec('SELECT dict, doc FROM autosave')[0]!.values[0]!;
		assert.deepEqual(repaired[0], original[0]);
		const tokens = decodeAudacityBinaryXml(repaired[0], repaired[1]).documentTokens as Array<{ name?: string; value?: unknown }>;
		assert.deepEqual(tokens.filter(token => token.name === 'blockid').map(token => token.value), [-6]);
	} finally { db.close(); }
});

test('shared missing blocks are reported at every clip and patched with each reference duration', async () => {
	const db = new SQL.Database(await createAup3Fixture({ tracks: [{ clips: [
		{ name: 'First', offset: 1, blocks: [{ id: 9, samples: [0.25, 0.5], missing: true }] },
		{ name: 'Second', offset: 3, blocks: [{ id: 9, samples: [0.25, 0.5, 0.75], missing: true }] },
	] }] }));
	try {
		assert.deepEqual(inspectAudacityRecovery(db).missing.map(block => [block.clip, block.samples]), [['First', 2], ['Second', 3]]);
		assert.equal(repairAudacityNativeCopy(db).repairedReferences, 2);
		const row = db.exec('SELECT dict, doc FROM project')[0]!.values[0]!;
		const tokens = decodeAudacityBinaryXml(row[0], row[1]).documentTokens as Array<{ name?: string; value?: unknown }>;
		assert.deepEqual(tokens.filter(token => token.name === 'blockid').map(token => token.value), [-2, -3]);
	} finally { db.close(); }
});
