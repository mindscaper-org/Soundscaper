/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act, StrictMode } from 'react';
import { useLightscaperDesktopArchiveOpenCurrentV1 } from '../src/common/editor/ui/lightscaper/use-lightscaper-desktop-archive-open-current-v1.ts';
import type { DesktopLightscaperArchiveOpenBridgeCurrentV1, DesktopLightscaperArchiveOpenDescriptorCurrentV1 } from '../src/common/editor/desktop-lightscaper-archive-open-contract-current-v1.ts';
import { DESKTOP_READ_PROFILE_SCAPE_RANGE, DESKTOP_SCAPE_MIME_TYPE } from '../src/common/editor/desktop-read-profile.ts';
import { mountPhotoImportUi } from './helpers/photo-import-options-react-fixture.tsx';
import { deferred, remainsPending, settle } from './helpers/async-test-control.ts';

test('Lightscaper archive hook survives StrictMode and Session-like rerenders without automatic restore', async () => {
	const file = new File(['archive'], 'Owned.liscape'), id = 'a'.repeat(64);
	const descriptor: DesktopLightscaperArchiveOpenDescriptorCurrentV1 = { id, name: file.name, size: file.size, lastModified: 0,
		url: `lightscaper-app://bundle/_desktop/read/${DESKTOP_READ_PROFILE_SCAPE_RANGE}/${id}/${file.name}`,
		mimeType: DESKTOP_SCAPE_MIME_TYPE, readProfile: DESKTOP_READ_PROFILE_SCAPE_RANGE };
	let takes = 0, loads = 0, presents = 0, deletes = 0, restoreRetirements = 0;
	const errors: unknown[] = [], restore = deferred<string>(), retiring = deferred<void>();
	const bridge: DesktopLightscaperArchiveOpenBridgeCurrentV1 = {
		takeArchive: async () => { takes++; return takes === 1 ? descriptor : null; }, finishArchive: async () => {},
		onArchiveAvailable: () => () => {},
	};
	let current: ReturnType<typeof useLightscaperDesktopArchiveOpenCurrentV1> | undefined;
	function Harness() {
		current = useLightscaperDesktopArchiveOpenCurrentV1({ canPresent: () => true, onPresent: () => { presents++; },
			load: async () => { loads++; return { file, close: async () => { deletes++; } }; },
			retireRestore: async () => { restoreRetirements++; await retiring.promise; }, reportError: error => { errors.push(error); } });
		return null;
	}
	const mounted = await mountPhotoImportUi(() => {
		Object.defineProperty(window, 'lightscaperDesktop', { configurable: true, value: { v1: bridge } });
		return <StrictMode><Harness /></StrictMode>;
	});
	assert.ok(current); let disposed = false; let work: Promise<string> | undefined, hiding: Promise<void> | undefined;
	try {
		await act(async () => { await settle(); });
		assert.equal(takes, 1); assert.equal(loads, 1); assert.equal(presents, 1); assert.equal(restoreRetirements, 0);
		assert.equal(current.file, file);
		await mounted.render(); assert.equal(current.file, file); assert.equal(loads, 1);
		await act(async () => { work = current!.withFileConsumer(file, async () => restore.promise); hiding = current!.dismiss(); await settle(); });
		assert.equal(deletes, 0); const saved = current;
		await mounted.dispose(); disposed = true; assert.equal(restoreRetirements, 1); assert.equal(deletes, 0);
		restore.resolve('ack'); assert.equal(await work, 'ack'); await settle(); assert.equal(deletes, 0);
		const closed = saved.retireAndJoin(); assert.equal(await remainsPending(closed), true);
		retiring.resolve(); await closed; await hiding;
		assert.equal(deletes, 1); assert.deepEqual(errors, []);
		await assert.rejects(saved.withFileConsumer(file, async () => 'stale'), { name: 'AbortError' });
	} catch (error) {
		restore.resolve('ack'); retiring.resolve(); await work; await hiding; if (!disposed) await mounted.dispose(); throw error;
	}
});

test('Lightscaper browser and older desktop bridge preserve manual restore without archive capability alerts', async () => {
	for (const bridge of [undefined, {
		signalReady() {}, onCloseRequested: () => () => {}, respondToClose: async () => {},
		getEnvironment: async () => ({}), getWindowState: async () => ({}),
	}, { takeArchive: async () => assert.fail('Incomplete archive bridge'), onArchiveAvailable: () => () => {} }]) {
		let current: ReturnType<typeof useLightscaperDesktopArchiveOpenCurrentV1> | undefined, loads = 0;
		const errors: unknown[] = [];
		function Harness() {
			current = useLightscaperDesktopArchiveOpenCurrentV1({ canPresent: () => true, onPresent: () => assert.fail('No OS request'),
				retireRestore: async () => assert.fail('No staged desktop File'), reportError: error => { errors.push(error); },
				load: async () => { loads++; throw new Error('No archive capability'); } }); return null;
		}
		const mounted = await mountPhotoImportUi(() => {
			Object.defineProperty(window, 'lightscaperDesktop', { configurable: true, value: bridge ? { v1: bridge } : undefined });
			return <Harness />;
		});
		try {
			assert.ok(current); const file = new File(['manual'], 'Browser.scape');
			assert.equal(await current.withFileConsumer(file, async source => source), file);
			assert.equal(current.file, null); assert.equal(loads, 0); assert.deepEqual(errors, []);
		} finally { await mounted.dispose(); }
	}
});

test('Lightscaper external dialog mutations wake queued admission without a kernel rerender and disconnect on unmount', async () => {
	const prior = Object.getOwnPropertyDescriptor(globalThis, 'MutationObserver');
	const observers: { wake: () => void; disconnected: boolean }[] = [];
	class Observer {
		readonly record: { wake: () => void; disconnected: boolean };
		constructor(wake: () => void) { this.record = { wake, disconnected: false }; observers.push(this.record); }
		observe(target: Node, options: MutationObserverInit) {
			assert.equal(target, document);
			assert.deepEqual(options, { childList: true, subtree: true, attributes: true, attributeFilter: ['role', 'open'] });
		}
		disconnect() { this.record.disconnected = true; }
	}
	Object.defineProperty(globalThis, 'MutationObserver', { configurable: true, value: Observer });
	const file = new File(['archive'], 'Queued.liscape'), id = 'b'.repeat(64);
	const descriptor: DesktopLightscaperArchiveOpenDescriptorCurrentV1 = { id, name: file.name, size: file.size, lastModified: 0,
		url: `lightscaper-app://bundle/_desktop/read/${DESKTOP_READ_PROFILE_SCAPE_RANGE}/${id}/${file.name}`,
		mimeType: DESKTOP_SCAPE_MIME_TYPE, readProfile: DESKTOP_READ_PROFILE_SCAPE_RANGE };
	let safe = false, takes = 0, presents = 0, deletes = 0;
	const errors: unknown[] = [];
	const bridge: DesktopLightscaperArchiveOpenBridgeCurrentV1 = { takeArchive: async () => { takes++; return descriptor; },
		finishArchive: async () => {}, onArchiveAvailable: () => () => {} };
	let current: ReturnType<typeof useLightscaperDesktopArchiveOpenCurrentV1> | undefined;
	function Harness() {
		current = useLightscaperDesktopArchiveOpenCurrentV1({ canPresent: () => safe, onPresent: () => { presents++; },
			load: async () => ({ file, close: async () => { deletes++; } }), retireRestore: async () => {},
			reportError: error => { errors.push(error); } }); return null;
	}
	const mounted = await mountPhotoImportUi(() => {
		Object.defineProperty(window, 'lightscaperDesktop', { configurable: true, value: { v1: bridge } }); return <Harness />;
	});
	let disposed = false;
	try {
		assert.ok(current); await act(async () => { await settle(); }); assert.equal(takes, 0);
		safe = true; await act(async () => { observers[0]!.wake(); await settle(); });
		assert.equal(takes, 1); assert.equal(presents, 1); assert.equal(current.file, file);
		await mounted.dispose(); disposed = true; await current.retireAndJoin();
		assert.equal(observers[0]!.disconnected, true); assert.equal(deletes, 1);
		observers[0]!.wake(); await settle(); assert.equal(takes, 1); assert.deepEqual(errors, []);
	} finally {
		if (!disposed) { await mounted.dispose(); await current?.retireAndJoin(); }
		if (prior) Object.defineProperty(globalThis, 'MutationObserver', prior); else Reflect.deleteProperty(globalThis, 'MutationObserver');
	}
});
