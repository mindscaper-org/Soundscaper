/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import React, { act, StrictMode } from 'react';
import LightscaperAppCurrentV1, { type LightscaperAppPropsCurrentV1 } from '../src/common/editor/ui/lightscaper/LightscaperAppCurrentV1.tsx';
import type { LightscaperDesktopCloseResponse, LightscaperDesktopLifecycleBridge } from '../src/common/editor/controller/composition/lightscaper-desktop-lifecycle.ts';
import { createPhotoLibrarySessionCurrentV1 } from '../src/lightscaper/photo-library-session-runtime-current-v1.ts';
import { createPhotoDevelopRenderRuntimeCurrentV1 } from '../src/lightscaper/photo-develop-render-runtime-current-v1.ts';
import { photoDevelopCopy } from '../src/common/i18n/lightscaper-develop-copy.ts';
import { seedCurrentAppPhoto, currentAppLocks, currentAppCanvasBoundary } from './helpers/lightscaper-current-app-fixture.tsx';
import { mediaRestoreFixture } from './helpers/lightscaper-media-restore-fixture.ts';
import { InstrumentedKeyRange } from './helpers/instrumented-indexeddb-keys.ts';
import { mountPhotoImportUi } from './helpers/photo-import-options-react-fixture.tsx';
import { reactProps } from './helpers/react-test-dom.ts';
import { deferred, settle, waitFor } from './helpers/async-test-control.ts';

const priorKeyRange = Object.getOwnPropertyDescriptor(globalThis, 'IDBKeyRange');
Object.defineProperty(globalThis, 'IDBKeyRange', { configurable: true, value: InstrumentedKeyRange });
after(() => { if (priorKeyRange) Object.defineProperty(globalThis, 'IDBKeyRange', priorKeyRange); else Reflect.deleteProperty(globalThis, 'IDBKeyRange'); });

async function mount(options: {
	readonly closeGate?: Promise<void>;
	readonly readGate?: Promise<void>;
	readonly restore?: LightscaperAppPropsCurrentV1['loadRestoreRuntime'];
} = {}) {
	const native = mediaRestoreFixture(), seeded = await seedCurrentAppPhoto(native.factory, currentAppLocks()), canvas = currentAppCanvasBoundary();
	const responses: LightscaperDesktopCloseResponse[] = [], alerts: string[] = [], sessions: Awaited<ReturnType<typeof createPhotoLibrarySessionCurrentV1>>[] = [];
	let ready = 0, opens = 0, closes = 0, unsubscribe = 0, listener: ((value: unknown) => void) | undefined, readSignal: AbortSignal | undefined;
	const bridge: LightscaperDesktopLifecycleBridge = { signalReady() { ready++; },
		onCloseRequested(callback) { listener = callback; return () => { unsubscribe++; }; }, respondToClose(value) { responses.push(value); } };
	let host: Window | undefined; const previous = new Map<string, PropertyDescriptor | undefined>();
	const props: LightscaperAppPropsCurrentV1 = { locale: 'en',
		createSession: async () => {
			opens++; const session = await createPhotoLibrarySessionCurrentV1(seeded.options), close = session.close, readPage = session.readPage;
			sessions.push(session);
			Object.defineProperty(session, 'close', { configurable: true, value: async () => {
				closes++; await options.closeGate; await (Reflect.apply(close, session, []) as Promise<void>);
			} });
			if (options.readGate) Object.defineProperty(session, 'readPage', { configurable: true,
				value: async (...args: Parameters<typeof readPage>) => {
					readSignal = args[0]?.signal; await options.readGate;
					return Reflect.apply(readPage, session, args) as ReturnType<typeof readPage>;
				} });
			return session;
		}, loadDevelopProxyRuntime: async (source, maskSource) => createPhotoDevelopRenderRuntimeCurrentV1({ source, ...(maskSource ? { maskSource } : {}) }),
		...(options.restore ? { loadRestoreRuntime: options.restore } : {}) };
	const mounted = await mountPhotoImportUi(() => {
		if (!host) {
			host = window;
			for (const [name, value] of Object.entries({ lightscaperDesktop: Object.freeze({ v1: bridge }), alert: (message: string) => { alerts.push(message); }, dispatchEvent: () => true })) {
				previous.set(name, Object.getOwnPropertyDescriptor(host, name)); Object.defineProperty(host, name, { configurable: true, value });
			}
		}
		return <StrictMode><LightscaperAppCurrentV1 {...props} /></StrictMode>;
	});
	const flush = async (run: () => void = () => undefined) => { await act(async () => { run(); await settle(); }); };
	const button = (name: string) => {
		const found = mounted.dom.container.querySelectorAll('button').find(value => value.textContent === name); assert.ok(found, name); return found;
	};
	const click = async (name: string) => { const target = button(name); await flush(() => { reactProps(target).onClick?.({ currentTarget: target }); }); };
	await flush();
	return { ...mounted, responses, alerts, seeded, flush, click, button,
		counts: () => ({ ready, opens, closes, unsubscribe }), readSignal: () => readSignal,
		async close(requestId = 'close-1') { assert.ok(listener); await flush(() => { listener!({ requestId, reason: 'window-close' }); }); },
		async showPhoto() {
			await click('Show photo library');
			await waitFor(async () => { await flush(); return mounted.dom.find('[data-photo-id]') !== null; }, 'actual Current Photo3 library');
			const card = mounted.dom.one('[data-photo-id]'); await flush(() => { reactProps(card).onClick?.({ ctrlKey: false, metaKey: false, shiftKey: false }); });
		},
		async dispose() {
			try { await mounted.dispose(); await Promise.all(sessions.map(session => session.close())); }
			finally { canvas.restore(); if (host) for (const [name, descriptor] of previous) {
				if (descriptor) Object.defineProperty(host, name, descriptor); else Reflect.deleteProperty(host, name);
			} }
		} };
}

test('actual Current App signals desktop ready once after StrictMode mount without opening its menu-only Session', async () => {
	const m = await mount();
	try {
		assert.equal(m.counts().ready, 1); assert.equal(m.counts().opens, 0);
		assert.ok(m.dom.one('[data-lightscaper-bound="true"]').isConnected); assert.equal(m.dom.find('[data-photo-library]'), null);
		await m.close(); assert.deepEqual(m.responses, [{ requestId: 'close-1', allow: true }]); assert.equal(m.counts().opens, 0);
	} finally { await m.dispose(); }
});

test('OS close keeps an actual unsaved Current Develop draft editable and its persisted settings unchanged', async () => {
	const m = await mount(), messages = photoDevelopCopy('en');
	try {
		await m.showPhoto(); await m.click('Develop…');
		await waitFor(async () => { await m.flush(); return m.dom.find('[data-photo-develop-effects]') !== null; }, 'Current Develop authoring');
		await m.click(messages.add); assert.ok(m.dom.find('[data-photo-develop-effect="white-balance-v1"]'));
		assert.equal(reactProps(m.button(messages.save)).disabled, false);
		const reader = await createPhotoLibrarySessionCurrentV1(m.seeded.options);
		let before: Awaited<ReturnType<typeof reader.develop.read>>;
		try { before = await reader.develop.read({ schemaVersion: 3, photoId: m.seeded.photo.id }); } finally { await reader.close(); }
		await m.close(); assert.deepEqual(m.responses, [{ requestId: 'close-1', allow: false }]);
		assert.equal(m.counts().closes, 0); assert.equal(m.alerts.length, 1); assert.equal(reactProps(m.button(messages.save)).disabled, false);
		assert.ok(m.dom.find('[data-photo-develop-effect="white-balance-v1"]')); await m.click(messages.add);
		assert.equal(m.dom.container.querySelectorAll('[data-photo-develop-effect="white-balance-v1"]').length, 2);
		const after = await createPhotoLibrarySessionCurrentV1(m.seeded.options);
		try { assert.deepEqual(await after.develop.read({ schemaVersion: 3, photoId: m.seeded.photo.id }), before); } finally { await after.close(); }
	} finally { await m.dispose(); }
});

test('safe desktop close joins the actual selected Session close and fences retained real menu callbacks before ACK', async () => {
	const release = deferred<void>(), m = await mount({ closeGate: release.promise });
	try {
		await m.showPhoto(); const menu = m.button('Edit metadata'), retained = reactProps(menu).onClick;
		await m.close(); assert.deepEqual(m.responses, []); assert.equal(m.counts().closes, 1);
		assert.equal(Reflect.get(m.dom.one('[data-lightscaper-bound="true"]'), 'inert'), true);
		await m.flush(() => { retained?.({ currentTarget: menu }); }); assert.equal(m.dom.find('[role="dialog"]'), null);
		release.resolve(); await m.flush(); assert.deepEqual(m.responses, [{ requestId: 'close-1', allow: true }]);
	} finally { release.resolve(); await m.flush(); await m.dispose(); }
});

test('a held actual Current page read receives a close veto without being aborted and remains usable afterward', async () => {
	const release = deferred<void>(), m = await mount({ readGate: release.promise });
	try {
		await m.click('Show photo library'); await waitFor(() => m.readSignal() !== undefined, 'actual Current read admission');
		await m.close(); assert.deepEqual(m.responses, [{ requestId: 'close-1', allow: false }]);
		assert.equal(m.readSignal()?.aborted, false); assert.equal(m.counts().closes, 0);
		release.resolve(); await waitFor(async () => { await m.flush(); return m.dom.find('[data-photo-id]') !== null; }, 'Current page after veto');
		await m.close('close-2'); assert.deepEqual(m.responses.at(-1), { requestId: 'close-2', allow: true });
	} finally { release.resolve(); await m.flush(); await m.dispose(); }
});

test('hiding a pending Restore dialog cannot make the actual app-lifetime restore owner safe to close', async () => {
	const release = deferred<void>(); let signal: AbortSignal | undefined, entered = false;
	const m = await mount({ restore: async () => ({ restoreArchive: async (_blob, options) => {
		entered = true; signal = options?.signal; await release.promise; options?.signal?.throwIfAborted();
		return { catalogId: 'restored', catalogName: 'Restored', photoCount: 0, stackCount: 0, savedCollectionCount: 0,
			originalCount: 0, originalByteLength: 0, notices: [] };
	}, close: async () => undefined }) });
	try {
		await m.event('[data-photo-restore-menu]', 'onClick', { currentTarget: m.dom.one('[data-photo-restore-menu]') });
		await m.event('[data-photo-restore-file]', 'onChange', { currentTarget: { files: [new File(['fixture'], 'Library.liscape')] } });
		await m.event('[data-photo-restore-start]', 'onClick'); await waitFor(() => entered, 'stable Restore owner admission');
		await m.event('[data-photo-restore-close]', 'onClick'); assert.equal(m.dom.find('[data-photo-restore-dialog]'), null);
		await m.close(); assert.deepEqual(m.responses, [{ requestId: 'close-1', allow: false }]); assert.equal(signal?.aborted, false);
		release.resolve(); await m.flush(); await m.close('close-2'); assert.deepEqual(m.responses.at(-1), { requestId: 'close-2', allow: true });
	} finally { release.resolve(); await m.flush(); await m.dispose(); }
});
