/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createNativeAepImportService } from '../src/common/editor/controller/import/native-aep-import.ts';
import { createMotionscaperProjectStore } from '../src/motionscaper/editor-project-store.ts';
import { exportMotionscaperArchive, importMotionscaperArchive } from '../src/motionscaper/editor-scape.ts';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';
import { nativeAepFixture } from './helpers/motionscaper-aep-fixture.ts';
test('native AEP import retains the exact source through review, atomic publication, Save and archive reopen', async () => {
	const database = createInstrumentedIndexedDB(), store = createMotionscaperProjectStore({ indexedDB: database as unknown as IDBFactory });
	const destination = createMotionscaperProjectStore({ indexedDB: createInstrumentedIndexedDB() as unknown as IDBFactory });
	const bytes = nativeAepFixture(), file = new Blob([bytes]); let starts = 0;
	try {
		const service = createNativeAepImportService({ begin: project => { starts++; return store.beginImport(project); } });
		const prepared = await service.prepare({ file, name: 'Original.aep' }); assert.equal(starts, 0);
		await assert.rejects(service.commit(prepared, false), /acknowledge/iu); assert.equal(starts, 0);
		await service.commit(prepared, true); assert.equal(starts, 1);
		await assert.rejects(service.commit(prepared, true), /published/iu);
		const saved = (await store.load(prepared.project.id))!.project, source = saved.assets.find(asset => asset.id === saved.nativeImport!.sourceAssetId)!;
		assert.deepEqual(new Uint8Array(await (await store.loadAsset(source))!.arrayBuffer()), bytes);
		const archive = await exportMotionscaperArchive(saved, asset => store.readAsset(asset)); assert.ok(archive);
		await importMotionscaperArchive(archive, project => destination.beginImport(project));
		const reopened = (await destination.load(saved.id))!.project;
		assert.deepEqual(reopened.nativeImport, saved.nativeImport); assert.deepEqual(reopened.compositions, saved.compositions);
		assert.deepEqual(new Uint8Array(await (await destination.loadAsset(source))!.arrayBuffer()), bytes);
	} finally { await store.close(); await destination.close(); }
});
test('native AEP import rejects malformed input, wrong review authority and cancelled work before publication', async () => {
	let writes = 0; const begin = () => { writes++; throw new Error('Unexpected transaction'); };
	const service = createNativeAepImportService({ begin });
	await assert.rejects(service.prepare({ file: new Blob(['not an aep file']), name: 'Broken.aep' })); assert.equal(writes, 0);
	const prepared = await service.prepare({ file: new Blob([nativeAepFixture()]), name: 'Original.aep' });
	await assert.rejects(createNativeAepImportService({ begin }).commit(prepared, true), /unknown/iu);
	const abort = new AbortController(); abort.abort();
	await assert.rejects(service.commit(prepared, true, abort.signal), { name: 'AbortError' }); assert.equal(writes, 0);
});
test('native AEP publication rolls back private chunks when writing fails', async () => {
	const calls: string[] = [], service = createNativeAepImportService({ begin: () => ({
		writeAssetChunk: () => { calls.push('write'); return Promise.reject(new Error('write failure')); }, finishAsset: () => Promise.resolve(),
		commit: () => { calls.push('commit'); return Promise.resolve(); }, rollback: () => { calls.push('rollback'); return Promise.resolve(); },
	}) });
	const prepared = await service.prepare({ file: new Blob([nativeAepFixture()]), name: 'Original.aep' });
	await assert.rejects(service.commit(prepared, true), /write failure/u); assert.deepEqual(calls, ['write', 'rollback']);
});
test('failed private AEP cleanup retains its exact transaction for retry before publication can resume', async () => {
	let rollbacks = 0, starts = 0;
	const service = createNativeAepImportService({ begin: () => { starts++; return {
		writeAssetChunk: () => Promise.reject(new Error('write failure')), finishAsset: () => Promise.resolve(), commit: () => Promise.resolve(),
		rollback: () => ++rollbacks === 1 ? Promise.reject(new Error('cleanup failure')) : Promise.resolve(),
	}; } });
	const prepared = await service.prepare({ file: new Blob([nativeAepFixture()]), name: 'Original.aep' });
	await assert.rejects(service.commit(prepared, true), AggregateError); assert.equal(service.needsCleanup(prepared), true);
	await assert.rejects(service.commit(prepared, true), /closed/iu); assert.equal(starts, 1);
	await service.retryCleanup(prepared); assert.equal(service.needsCleanup(prepared), false); assert.equal(rollbacks, 2);
	await assert.rejects(service.retryCleanup(prepared), /No pending/u);
});
