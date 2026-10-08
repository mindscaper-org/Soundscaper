/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { recoverAudacityProjectDatabase } from '../src/common/editor/audacity-project-recovery.ts';
import { decodeAudacityProjectTree } from '../src/common/editor/aup4-conversion.js';
import { initializeAup4Database, insertAup4SampleBlock, writeAup4Document } from '../src/common/editor/aup4-database.js';
import { streamAup4SourceAudio } from '../src/common/editor/aup4-import-audio.ts';
import type { Aup4ImportSourcePlan } from '../src/common/editor/aup4-import-plan.ts';
import { readRecoveredAudacitySamples } from '../src/common/editor/audacity-project-recovery-audio.ts';
import { AUP4_USER_VERSION, createAup4SampleBlock } from '../src/common/editor/aup4-profile.js';
import { createAup3Fixture } from './aup3-fixture.js';
import { SQL, documentBytes, projectWithBlocks } from './helpers/aup4-database-harness.js';

test('recovery chooses the last saved project after corrupt autosave without modifying input', () => {
	const database = new SQL.Database();
	try {
		initializeAup4Database(database);
		writeAup4Document(database, documentBytes(44_100), { autosave: false });
		writeAup4Document(database, documentBytes(48_000));
		database.run('UPDATE autosave SET doc = substr(doc, 1, length(doc) - 1)');
		const before = database.export();
		const recovered = recoverAudacityProjectDatabase(database);
		assert.equal(recovered.source, 'project');
		assert.equal(recovered.summary.sampleRate, 44_100);
		assert.equal(recovered.recovery.failures[0]?.source, 'autosave');
		assert.ok(recovered.compatibilityReport.items.some((item) => item.code === 'RECOVERED_DOCUMENT'));
		assert.deepEqual(database.export(), before);
	} finally { database.close(); }
});

test('recovery finds a usable committed history snapshot after both current documents fail', () => {
	const database = new SQL.Database();
	try {
		initializeAup4Database(database);
		writeAup4Document(database, documentBytes(44_100), { autosave: false });
		writeAup4Document(database, documentBytes(48_000), { autosave: false });
		writeAup4Document(database, documentBytes(96_000));
		database.run('UPDATE project SET doc = x\'ff\'');
		database.run('UPDATE autosave SET doc = x\'ff\'');
		database.run('UPDATE project_history SET doc = x\'ff\' WHERE generation = 2');
		const recovered = recoverAudacityProjectDatabase(database);
		assert.equal(recovered.source, 'history');
		assert.equal(recovered.generation, 1);
		assert.equal(recovered.summary.sampleRate, 44_100);
	} finally { database.close(); }
});

test('recovery rejects future profiles instead of downgrading to a readable older document', () => {
	const database = new SQL.Database();
	try {
		initializeAup4Database(database);
		writeAup4Document(database, documentBytes(44_100), { autosave: false });
		writeAup4Document(database, documentBytes(48_000, '99.0.0'));
		const before = database.export();
		assert.throws(() => recoverAudacityProjectDatabase(database), { code: 'NEWER_XML' });
		assert.deepEqual(database.export(), before);
		database.run(`PRAGMA user_version = ${String(AUP4_USER_VERSION + 1)}`);
		assert.throws(() => recoverAudacityProjectDatabase(database), { code: 'NEWER_DATABASE' });
	} finally { database.close(); }
});

test('missing AUP3 blocks become exactly timed silence while adjacent audio and clip placement survive', async () => {
	const bytes = await createAup3Fixture({ SQL, tracks: [{ name: 'Damaged recording', clips: [{ offset: 2,
		blocks: [{ id: 1, samples: [0.25, -0.5] }, { id: 2, samples: [0.75, 0.5, 0.25], missing: true },
			{ id: 3, samples: [-0.25] }] }] }] });
	const database = new SQL.Database(bytes);
	try {
		const before = database.export();
		const recovered = recoverAudacityProjectDatabase(database);
		const decoded = await decodeAudacityProjectTree(recovered.document.root, () => assert.fail('planning reads no PCM'), { planAudio: true });
		assert.equal(decoded.project.clips[0]?.timelineStartFrame, 96_000);
		assert.equal(decoded.project.clips[0]?.durationFrames, 6);
		assert.deepEqual(await samples(database, recovered, decoded.sources[0] as Aup4ImportSourcePlan), [0.25, -0.5, 0, 0, 0, -0.25]);
		const loss = recovered.compatibilityReport.items.find((item) => item.code === 'RECOVERED_AUDIO_SILENCE');
		assert.equal(loss?.data.blockId, 2);
		assert.equal(loss?.data.silentFrames, 3);
		assert.deepEqual(database.export(), before);
	} finally { database.close(); }
});

test('truncated PCM keeps its readable prefix, repairs the silent tail, and ignores broken preview summaries', async () => {
	const database = new SQL.Database();
	try {
		initializeAup4Database(database);
		const block = createAup4SampleBlock(Float32Array.of(0.25, -0.5, 0.75, -0.25));
		const id = insertAup4SampleBlock(database, block);
		writeAup4Document(database, projectWithBlocks(id, 4));
		database.run('UPDATE sampleblocks SET samples = substr(samples, 1, 9), summary256 = x\'00\', sumrms = NULL');
		const recovered = recoverAudacityProjectDatabase(database);
		const decoded = await decodeAudacityProjectTree(recovered.document.root, () => assert.fail('planning reads no PCM'), { planAudio: true });
		assert.deepEqual(await samples(database, recovered, decoded.sources[0] as Aup4ImportSourcePlan), [0.25, -0.5, 0, 0]);
		assert.ok(recovered.compatibilityReport.items.some((item) => item.data.silentFrames === 2));
	} finally { database.close(); }
});

test('unreconstructable clip structure is omitted without shifting an intact later clip', async () => {
	const bytes = await createAup3Fixture({ SQL, tracks: [{ clips: [
		{ offset: 1, samples: [0.5], blockStart: 10 }, { offset: 3, samples: [0.25, -0.25] },
	] }] });
	const database = new SQL.Database(bytes);
	try {
		const recovered = recoverAudacityProjectDatabase(database);
		const decoded = await decodeAudacityProjectTree(recovered.document.root, () => assert.fail('planning reads no PCM'), { planAudio: true });
		assert.equal(decoded.project.clips.length, 1);
		assert.equal(decoded.project.clips[0]?.timelineStartFrame, 144_000);
		assert.ok(recovered.compatibilityReport.items.some((item) => item.code === 'RECOVERY_CLIP_OMITTED'));
	} finally { database.close(); }
});

test('an unreadable SQLite history page still allows its intact saved project and PCM to be salvaged', async () => {
	const original = new SQL.Database();
	let bytes: Uint8Array;
	try {
		initializeAup4Database(original);
		const id = insertAup4SampleBlock(original, createAup4SampleBlock(Float32Array.of(0.25, -0.5)));
		writeAup4Document(original, projectWithBlocks(id, 2), { autosave: false });
		const historyPage = Number(original.exec("SELECT rootpage FROM sqlite_master WHERE name = 'project_history'")[0]!.values[0]![0]);
		bytes = original.export();
		const pageSize = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint16(16);
		bytes[(historyPage - 1) * pageSize] = 0xff;
	} finally { original.close(); }
	const damaged = new SQL.Database(bytes);
	try {
		const recovered = recoverAudacityProjectDatabase(damaged);
		const decoded = await decodeAudacityProjectTree(recovered.document.root, () => assert.fail('planning reads no PCM'), { planAudio: true });
		assert.deepEqual(await samples(damaged, recovered, decoded.sources[0] as Aup4ImportSourcePlan), [0.25, -0.5]);
		assert.ok(recovered.compatibilityReport.items.some((item) => item.code === 'SQLITE_PARTIAL_RECOVERY'));
	} finally { damaged.close(); }
});

test('recovery refuses unsafe schemas and explains when no project document can be read', () => {
	const database = new SQL.Database();
	try {
		initializeAup4Database(database);
		writeAup4Document(database, documentBytes(44_100));
		database.run('CREATE TRIGGER unsafe AFTER INSERT ON project BEGIN DELETE FROM sampleblocks; END');
		assert.throws(() => recoverAudacityProjectDatabase(database), /Unexpected SQLite schema object/u);
		database.run('DROP TRIGGER unsafe');
		database.run('UPDATE autosave SET doc = x\'ff\'');
		assert.throws(() => recoverAudacityProjectDatabase(database), /No readable Audacity project.*original file.*Audacity Project Tools/u);
	} finally { database.close(); }
});

async function samples(database: unknown, recovered: ReturnType<typeof recoverAudacityProjectDatabase>, source: Aup4ImportSourcePlan): Promise<number[]> {
	const result: number[] = [];
	for await (const chunk of streamAup4SourceAudio(source, (block, offset, frames) => readRecoveredAudacitySamples(database, recovered.audio, block, offset, frames))) {
		result.push(...chunk[0]!);
	}
	return result;
}
