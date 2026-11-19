/* SPDX-License-Identifier: AGPL-3.0-only */

import { test, expect } from './helpers/browser-coverage-fixture.js';
import { ordinaryBrowserProductSitePlan } from '../../scripts/lib/browser-product-site-plan.mjs';

const origin = ordinaryBrowserProductSitePlan().sites[0].origin;
test.use({ browserCoverage: false, locale: 'de-DE', timezoneId: 'UTC', viewport: { width: 777, height: 555 },
	contextOptions: { reducedMotion: 'reduce' },
	storageState: { cookies: [], origins: [{ origin, localStorage: [{ name: 'fixture-seed', value: 'present' }] }] },
});

// Both independently scheduled cases start with the same absent IDB marker.
// A shared persistent profile would make one fail even with one worker.
for (const round of [1, 2]) test(`fresh real browser storage retains exact ArrayBuffer/Blob/File data and effective fixture options (${round})`, async ({ page, context }) => {
	test.setTimeout(30_000);
	await page.goto('/privacy/');
	expect(page.context()).toBe(context);
	expect(context.pages()).toEqual([page]);
	const observation = await page.evaluate(async () => {
		const pending = indexedDB.open('scape-browser-context-isolation', 1);
		pending.onupgradeneeded = () => pending.result.createObjectStore('values');
		const database = await new Promise((resolve, reject) => { pending.onsuccess = () => resolve(pending.result); pending.onerror = () => reject(pending.error); });
		const transact = async (mode, enqueue) => {
			const transaction = database.transaction('values', mode);
			let failed = false, primary;
			const cleanup = [];
			const terminal = new Promise(resolve => {
				transaction.oncomplete = () => resolve({ committed: true });
				transaction.onabort = () => resolve({ committed: false });
			});
			const abort = error => {
				if (failed) return;
				failed = true; primary = error;
				try { transaction.abort(); } catch (failure) { cleanup.push(failure); }
			};
			transaction.onerror = () => abort(transaction.error ?? new Error('The actual storage transaction failed.'));
			const watch = request => {
				request.onerror = () => abort(request.error ?? new Error('The actual storage request failed.'));
				return request;
			};
			try { enqueue(transaction.objectStore('values'), watch); } catch (error) { abort(error); }
			const result = await terminal;
			if (failed) {
				if (cleanup.length) throw new AggregateError([primary, ...cleanup], 'Storage request failed and abort also refused.', { cause: primary });
				throw primary;
			}
			if (!result.committed) throw transaction.error ?? new Error('The actual storage transaction aborted.');
		};
		const read = async key => {
			let value;
			await transact('readonly', (store, watch) => {
				const request = watch(store.get(key)); request.onsuccess = () => { value = request.result; };
			});
			return value;
		};
		try {
			const before = await read('marker'), bytes = new Uint8Array([3, 7, 11]);
			await transact('readwrite', (store, watch) => {
				watch(store.put('owned', 'marker')); watch(store.put(bytes.buffer, 'buffer'));
				watch(store.put(new Blob([bytes], { type: 'application/octet-stream' }), 'blob'));
				watch(store.put(new File([bytes], 'native.bin', { type: 'application/octet-stream', lastModified: 1234 }), 'file'));
			});
			const buffer = await read('buffer'), blob = await read('blob'), file = await read('file');
			return { before, buffer: Array.from(new Uint8Array(buffer)), blob: Array.from(new Uint8Array(await blob.arrayBuffer())),
				file: { name: file.name, type: file.type, lastModified: file.lastModified, bytes: Array.from(new Uint8Array(await file.arrayBuffer())) },
				seed: localStorage.getItem('fixture-seed'), language: navigator.language,
				timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
				viewport: [innerWidth, innerHeight], reduced: matchMedia('(prefers-reduced-motion: reduce)').matches };
		} finally { database.close(); }
	});
	expect(observation).toEqual({ before: undefined, buffer: [3, 7, 11], blob: [3, 7, 11],
		file: { name: 'native.bin', type: 'application/octet-stream', lastModified: 1234, bytes: [3, 7, 11] },
		seed: 'present', language: 'de-DE', timezone: 'UTC', viewport: [777, 555], reduced: true });
	await page.reload();
	expect(await page.evaluate(() => localStorage.getItem('fixture-seed'))).toBe('present');
});
