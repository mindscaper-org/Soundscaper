/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SaveTargetStore, AtomicSaveManager } from '../desktop/save-targets.js';
import { createMacroBatchSaveService } from '../desktop/macro-batch-save.ts';

test('a batch folder grant mints targets as needed and never replaces an existing output', async t => {
	const directory = await mkdtemp(join(tmpdir(), 'macro-batch-'));
	t.after(() => rm(directory, { recursive: true, force: true }));
	const owner = {}, targets = new SaveTargetStore(), saves = new AtomicSaveManager({ targets });
	t.after(async () => { await saves.dispose(); targets.dispose(); });
	const service = createMacroBatchSaveService({ targets, chooseDirectory: async () => directory });
	const batch = await service.select(owner, ['episode-processed.wav']); assert.ok(batch);
	const target = service.prepare(owner, batch.id, 0);
	const write = await saves.begin({ owner, targetId: target.id, size: 3 });
	await saves.writeChunk({ owner, writeId: write.writeId, offset: 0, bytes: new Uint8Array([1, 2, 3]) });
	await saves.finish(write.writeId, { owner });
	assert.deepEqual(await readFile(join(directory, batch.files[0]!)), Buffer.from([1, 2, 3]));
	const target2 = service.prepare(owner, batch.id, 0);
	const next = await saves.begin({ owner, targetId: target2.id, size: 1 });
	await saves.writeChunk({ owner, writeId: next.writeId, offset: 0, bytes: new Uint8Array([9]) });
	await assert.rejects(saves.finish(next.writeId, { owner }));
	assert.deepEqual(await readFile(join(directory, batch.files[0]!)), Buffer.from([1, 2, 3]));
	assert.deepEqual(await readdir(directory), [batch.files[0]]);
	service.release(owner, batch.id);
});

test('batch output grants reject traversal, foreign owners and revoked destinations', async t => {
	const directory = await mkdtemp(join(tmpdir(), 'macro-grant-')); t.after(() => rm(directory, { recursive: true, force: true }));
	const targets = new SaveTargetStore(); t.after(() => targets.dispose());
	const owner = {}, service = createMacroBatchSaveService({ targets, chooseDirectory: async () => directory });
	await assert.rejects(service.select(owner, ['../escape.wav']));
	await assert.rejects(service.select(owner, ['episode\n.wav']));
	await writeFile(join(directory, 'episode.wav'), 'original');
	const batch = await service.select(owner, ['episode.wav', 'EPISODE.wav']); assert.ok(batch);
	assert.equal(new Set(batch.files.map(name => name.toLowerCase())).size, 2);
	assert.ok(batch.files.every(name => name !== 'episode.wav'));
	assert.throws(() => service.prepare({}, batch.id, 0), /grant/i);
	service.release(owner, batch.id);
	assert.throws(() => service.prepare(owner, batch.id, 0), /grant/i);
});
