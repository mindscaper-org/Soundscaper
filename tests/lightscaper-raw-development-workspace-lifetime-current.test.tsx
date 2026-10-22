/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import PhotoDevelopWorkspaceCurrentV1 from '../src/common/editor/ui/lightscaper/PhotoDevelopWorkspaceCurrentV1.tsx';
import type { PhotoDevelopWorkspacePropsCurrentV1 } from '../src/common/editor/ui/lightscaper/PhotoDevelopWorkspaceCurrentV1.tsx';
import { photoDevelopCopy } from '../src/common/i18n/lightscaper-develop-copy.ts';
import type { PhotoLibraryDevelopOriginalPortCurrentV1 } from '../src/common/editor/photo-library-develop-original-current-v1.ts';
import { createPhotoDevelopRenderRuntimeCurrentV1 } from '../src/lightscaper/photo-develop-render-runtime-current-v1.ts';
import { recoveryRasterFixture } from './helpers/lightscaper-raw-development-raster-export-fixture.ts';
import { currentAppCanvasBoundary } from './helpers/lightscaper-current-app-fixture.tsx';
import { mountPhotoImportUi } from './helpers/photo-import-options-react-fixture.tsx';
import { reactProps } from './helpers/react-test-dom.ts';
import { deferred, settle, waitFor } from './helpers/async-test-control.ts';

for (const action of ['Save', 'Discard'] as const) test(`held actual RAW verification fences retained parent ${action} and effect callbacks`, { timeout: 30_000 }, async context => {
	const words = photoDevelopCopy('en');
	const f = await recoveryRasterFixture('headroom'), canvas = currentAppCanvasBoundary(), release = deferred<void>();
	const retirements = new Set<() => Promise<void>>(), planes: Float32Array[] = [];
	const original = f.original, port = f.session.develop;
	const entered = deferred<void>();
	let resumed: ReturnType<typeof deferred<void>> | null = null;
	const nativeJoin = async <Value,>(operation: Promise<Value>): Promise<Value> => {
		const stopped = deferred<never>(), onAbort = () => { stopped.reject(context.signal.reason); };
		context.signal.addEventListener('abort', onAbort, { once: true });
		try { context.signal.throwIfAborted(); return await Promise.race([operation, stopped.promise]); }
		finally { context.signal.removeEventListener('abort', onAbort); }
	};
	void entered.promise.catch(() => undefined);
	const held: PhotoLibraryDevelopOriginalPortCurrentV1 = {
		withFrame: (request, consume, options) => original.withFrame(request, consume, options),
		withDerivedFrame: (request, consume, options) => {
			if (request.profile !== 'highlight-recovery-v1') return original.withDerivedFrame!(request, consume, options);
			const operation = original.withDerivedFrame!(request, async view => {
				const result = await consume(view);
				planes.push(view.frame.pixels); entered.resolve(); await release.promise;
				return result;
			}, options);
			void operation.catch((error: unknown) => { entered.reject(error); });
			return operation;
		},
	};
	Object.defineProperty(f.session, 'develop', { configurable: true, value: Object.freeze({ ...port, original: held }) });
	const runtime = createPhotoDevelopRenderRuntimeCurrentV1({ source: f.session.cubeLuts.source, maskSource: f.session.maskRasterSource });
	const register = (retire: () => Promise<void>) => { retirements.add(retire); return () => undefined; };
	const derived = f.request.withDerivedFrame; assert.ok(derived);
	const withDerivedFrame: NonNullable<PhotoLibraryDevelopOriginalPortCurrentV1['withDerivedFrame']> = (request, consume, options) => {
		const joining = resumed; resumed = null;
		if (joining) {
			assert.equal(request.photoId, f.saved.photoId); assert.equal(request.expectedRevision, f.saved.revision);
			assert.equal(request.profile, 'linear-headroom-v1');
		}
		const operation = derived(request, consume, options);
		if (joining) void operation.then(() => { joining.resolve(); }, (error: unknown) => { joining.reject(error); });
		return operation;
	};
	const props: PhotoDevelopWorkspacePropsCurrentV1 = { locale: 'en', photoId: f.saved.photoId, label: 'Recovery.dng',
		generation: {}, execute: f.execute, readPreview: (id, tier, options) => f.session.readPreview(id, tier, options),
		loadProxy: async () => runtime, withOriginalFrame: f.request.withOriginalFrame,
		withDerivedFrame, beforePresent: Promise.resolve(), registerRetirement: register,
		registerDemandRetirement: register, onClose: () => undefined };
	const mounted = await mountPhotoImportUi(() => <PhotoDevelopWorkspaceCurrentV1 {...props} />);
	const button = (name: string) => {
		const node = mounted.dom.container.querySelectorAll('button').find(value => value.textContent === name); assert.ok(node, name); return node;
	};
	const turn = async () => { await act(async () => { await settle(); }); };
	try {
		await waitFor(async () => { await turn(); return mounted.dom.container.querySelectorAll('button').some(node => node.textContent === words.add); }, 'native RAW Workspace');
		await act(async () => { reactProps(button(words.add)).onClick?.({}); await settle(); });
		assert.equal(mounted.dom.container.querySelectorAll('[data-photo-develop-effect]').length, 2);
		const retained = reactProps(button(action === 'Save' ? words.save : words.discard)).onClick, retainedAdd = reactProps(button(words.add)).onClick;
		assert.ok(retained); assert.ok(retainedAdd);
		await act(async () => { reactProps(button('RAW source processing')).onClick?.({}); retainedAdd({}); await settle(); });
		assert.equal(mounted.dom.container.querySelectorAll('[data-photo-develop-effect]').length, 2, 'Modal admission fences same-event parent edits.');
		await waitFor(async () => { await turn(); return mounted.dom.find('.lightscaper-raw-development-dialog') !== null; }, 'menu-owned RAW source modal');
		const dialog = mounted.dom.one('.lightscaper-raw-development-dialog'), select = dialog.querySelectorAll('select')[0]; assert.ok(select);
		await act(async () => { reactProps(select).onChange?.({ currentTarget: { value: 'recovery' } }); await settle(); });
		await act(async () => { await nativeJoin(entered.promise); });
		assert.ok(planes.some(plane => plane.some(value => value !== 0)));
		await act(async () => { retained({}); retainedAdd({}); await settle(); });
		assert.deepEqual(await f.session.develop.read({ schemaVersion: 3, photoId: f.saved.photoId }), f.saved);
		assert.equal(mounted.dom.container.querySelectorAll('[data-photo-develop-effect]').length, 2, 'The parent dirty draft stays unchanged.');
		const close = dialog.querySelectorAll('button').find(node => node.textContent === 'Close'); assert.ok(close);
		await act(async () => { reactProps(close).onClick?.({}); await settle(); });
		assert.ok(mounted.dom.find('.lightscaper-raw-development-dialog'), 'Close awaits the actual native borrow.');
		// The modal acquired its native proof only after all preceding previews
		// joined. Arm this exact post-Close headroom borrow, never an old render.
		const resumedPreview = deferred<void>(); resumed = resumedPreview;
		void resumedPreview.promise.catch(() => undefined);
		await act(async () => { release.resolve(); await settle(); });
		await waitFor(async () => { await turn(); return mounted.dom.find('.lightscaper-raw-development-dialog') === null; }, 'joined RAW modal Close');
		assert.ok(planes.every(plane => plane.every(value => value === 0)));
		// Real Worker result/termination is external to scheduler-turn counts.
		// Join the actual resumed scoped operation before the original UI check.
		await act(async () => { await nativeJoin(resumedPreview.promise); });
		try {
			await waitFor(async () => { await turn(); return f.canonical.active() === 0 && f.recovery.active() === 0
				&& mounted.dom.find('[data-photo-develop-preview]')?.getAttribute('data-state') === 'ready'; }, 'resumed native preview retirement');
		} catch (error) {
			console.error('RAW workspace resumed-preview observation', JSON.stringify({ action,
				canonical: { active: f.canonical.active(), statistics: f.canonical.statistics, events: f.canonical.events.slice(-32) },
				recovery: { active: f.recovery.active(), statistics: f.recovery.statistics, events: f.recovery.events.slice(-32) },
				previewState: mounted.dom.find('[data-photo-develop-preview]')?.getAttribute('data-state') ?? null,
				alerts: mounted.dom.container.querySelectorAll('[role="alert"]').map(node => node.textContent.slice(0, 256)).slice(0, 8),
				paintCount: canvas.painted.length, derivedEvents: f.events.slice(-32), retirements: retirements.size,
			}));
			throw error;
		}
		await f.assertCustody();
		await act(async () => { reactProps(button(words.save)).onClick?.({}); await settle(); });
		await waitFor(async () => { await turn(); return (await f.session.develop.read({ schemaVersion: 3, photoId: f.saved.photoId })).revision === f.saved.revision + 1; }, 'fresh parent Save after RAW retirement');
		const saved = await f.session.develop.read({ schemaVersion: 3, photoId: f.saved.photoId });
		assert.equal(saved.develop.processVersion, 4); assert.equal(saved.develop.effects.length, 2);
		if (saved.develop.processVersion !== 4) assert.fail('Parent Save must keep the full RAW recipe.');
		assert.equal(saved.develop.rawDevelopment.mode, 'headroom');
	} finally {
		release.resolve(); await mounted.dispose();
		try { await Promise.all([...retirements].map(retire => retire())); }
		finally { try { await f.close(); } finally { canvas.restore(); } }
	}
});
