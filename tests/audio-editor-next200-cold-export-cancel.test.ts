/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createDeferredEditorExportService, type DeferredEditorExportModule } from '../src/common/editor/controller/export/deferred-export-service.ts';
import { EditorControllerLifetime, EditorProjectGeneration } from '../src/common/editor/controller/shared/lifecycle.ts';

function fixture() {
	const lifetime = new EditorControllerLifetime(); lifetime.markReady();
	const projectGeneration = new EditorProjectGeneration(); projectGeneration.activate('same-project');
	const entries: unknown[][] = [];
	let release!: (module: DeferredEditorExportModule) => void;
	let reject!: (error: Error) => void;
	const held = new Promise<DeferredEditorExportModule>((resolve, fail) => { release = resolve; reject = fail; });
	const module = { createEditorExportService: () => ({
		handleExportAction: async (...args: unknown[]) => { entries.push(args); },
		exportVideo: async (...args: unknown[]) => { entries.push(['video', ...args]); },
		persistentAudioDeliveryAvailable: () => true,
		whenPersistentAudioDeliveryAvailable: async () => undefined,
	}) } as unknown as DeferredEditorExportModule;
	const runtime = { options: {}, sourceBuffers: new Map(), taskProgress: null, lifetime, projectGeneration,
		getProject: () => ({ id: 'same-project' }),
		state: { disposed: false, exportAbort: null, exportGeneration: 0, exportOutput: null,
			mobile: false, outputCleanup: null, outputUrl: null },
		createCacheAwareRenderEngine: () => ({}), prepareCommittedTimePitchCaches: async () => undefined,
		throwIfAborted() {}, updateExportProgress() {},
	};
	let loads = 0;
	const service = createDeferredEditorExportService(runtime, async () => { loads++; return await held; });
	return { service, entries, release: () => release(module), reject, loads: () => loads };
}

for (const kind of ['audio', 'video'] as const) {
	test(`Cancel retires a cold direct ${kind} request before its module starts fresh work`, async () => {
		const f = fixture();
		const old = kind === 'audio' ? f.service.handleExportAction('start', { name: 'old' })
			: f.service.exportVideo({ name: 'old' });
		const retired = assert.rejects(old, { name: 'AbortError' });
		const cancel = f.service.handleExportAction('cancel');
		const fresh = f.service.handleExportAction('start', { name: 'fresh' });
		f.release();
		await Promise.all([retired, cancel, fresh]);
		assert.deepEqual(f.entries, [['start', { name: 'fresh' }]]);
		assert.equal(f.loads(), 1);
	});
}

test('Cancel with no loaded service settles without loading delivery code', async () => {
	const f = fixture();
	let settled = false;
	const cancel = f.service.handleExportAction('cancel').then(() => { settled = true; });
	await new Promise<void>(resolve => setImmediate(resolve));
	assert.equal(settled, true);
	assert.equal(f.loads(), 0);
	f.release(); await cancel;
});

test('warm Cancel still delegates to the real exporter and preserves the next submission', async () => {
	const f = fixture(); f.release();
	await f.service.handleExportAction('start', { name: 'first' });
	await f.service.handleExportAction('cancel');
	await f.service.handleExportAction('start', { name: 'fresh' });
	assert.deepEqual(f.entries, [['start', { name: 'first' }], ['cancel'], ['start', { name: 'fresh' }]]);
});

test('a canceled cold request rejects as cancellation when loading subsequently fails', async () => {
	const f = fixture();
	const pending = f.service.handleExportAction('start');
	const retired = assert.rejects(pending, { name: 'AbortError' });
	const cancel = f.service.handleExportAction('cancel');
	f.reject(new Error('chunk unavailable'));
	await retired;
	await cancel;
	assert.deepEqual(f.entries, []);
});

test('persistent-owned cancellation does not retire a cold direct submission', async () => {
	const f = fixture();
	const pending = f.service.handleExportAction('start', { name: 'direct' });
	const cancel = f.service.handleExportAction('cancel', null, null, 'persistent');
	f.release(); await Promise.all([pending, cancel]);
	assert.deepEqual(f.entries, [['start', { name: 'direct' }], ['cancel', null, null, 'persistent']]);
});

test('direct cancellation preserves an explicit persistent-owned submission', async () => {
	const f = fixture();
	const pending = f.service.handleExportAction('start', { name: 'queued' }, null, 'persistent');
	await f.service.handleExportAction('cancel');
	f.release(); await pending;
	assert.deepEqual(f.entries, [['start', { name: 'queued' }, null, 'persistent']]);
});
