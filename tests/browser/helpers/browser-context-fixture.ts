/* SPDX-License-Identifier: AGPL-3.0-only */

import { test as base } from '@playwright/test';
import type { Browser } from '@playwright/test';
import { createBrowserStorageContextOwner } from './browser-storage-context-owner.ts';
import type { CreateBrowserContext } from './browser-storage-context-owner.ts';

interface SuiteBrowserOwner { get(): Promise<Browser>; allocateContextOrdinal(): number }

function throwFailures(failed: boolean, primary: unknown, cleanup: readonly unknown[]): void {
	const failures = failed ? [primary] : [];
	for (const failure of cleanup) if (!failures.some(value => Object.is(value, failure))) failures.push(failure);
	if (failures.length > 1) throw new AggregateError(failures, 'Browser fixture and actual retirement failed.', { cause: failures[0] });
	if (failures.length) throw failures[0];
}

/** A lazy worker Browser prevents an unused ordinary WebKit process per test. */
export const test = base.extend<{ createBrowserContext: CreateBrowserContext }, { suiteBrowserOwner: SuiteBrowserOwner }>({
	suiteBrowserOwner: [async ({ playwright, browserName, connectOptions }, use) => {
		let opening: Promise<Browser> | undefined;
		let closing = false, failed = false, contextOrdinal = 0;
		let primary: unknown;
		const cleanup: unknown[] = [];
		const get = () => {
			if (closing) throw new Error('The suite browser owner is closing.');
			// The automatic Playwright Test launch fixture supplies effective
			// launchOptions/headless/channel to these public calls.
			opening ??= connectOptions ? playwright[browserName].connect(connectOptions) : playwright[browserName].launch();
			return opening;
		};
		const allocateContextOrdinal = () => {
			if (closing) throw new Error('The suite browser owner is closing.');
			const ordinal = contextOrdinal; contextOrdinal += 1;
			return ordinal;
		};
		try { await use(Object.freeze({ get, allocateContextOrdinal })); }
		catch (error) { failed = true; primary = error; }
		closing = true;
		if (opening) {
			try { await (await opening).close({ reason: 'Test worker ended.' }); }
			catch (error) { cleanup.push(error); }
		}
		throwFailures(failed, primary, cleanup);
	}, { scope: 'worker', timeout: 0 }],
	browser: [async ({ suiteBrowserOwner }, use) => {
		await use(await suiteBrowserOwner.get());
	}, { scope: 'worker', timeout: 0 }],
	createBrowserContext: async ({ playwright, browserName, suiteBrowserOwner, storageState, video, connectOptions, reuseContext }, use, testInfo) => {
		if (reuseContext) throw new Error('This end-to-end fixture requires a fresh isolated context per test.');
		if (browserName === 'webkit' && connectOptions) throw new Error('Persistent WebKit storage requires a local browser; remote private contexts are not substituted.');
		const owners: Array<ReturnType<typeof createBrowserStorageContextOwner>> = [];
		let stopping = false, failed = false;
		let primary: unknown;
		const cleanup: unknown[] = [];
		const create: CreateBrowserContext = (options = {}) => {
			if (stopping) throw new Error('The browser context factory is retiring.');
			const ordinal = suiteBrowserOwner.allocateContextOrdinal();
			const owner = createBrowserStorageContextOwner({ playwright, browserName, getBrowser: suiteBrowserOwner.get, storageState, video, testInfo }, ordinal);
			owners.push(owner);
			return owner.open(options);
		};
		// Test-scoped fixture owners are also joined after an intentional
		// beforeAll hook, whose archive work can use this public factory.
		try { await use(create); } catch (error) { failed = true; primary = error; }
		stopping = true;
		for (const owner of owners) {
			try { await owner.close(); } catch (error) { cleanup.push(error); }
		}
		throwFailures(failed, primary, cleanup);
	},
	context: async ({ createBrowserContext }, use) => {
		await use(await createBrowserContext());
	},
	page: async ({ context, browserName }, use) => {
		// Keep WebKit's actual persistent startup page: closing its last page
		// can destroy the native WebKitWebContext before a replacement opens.
		const page = browserName === 'webkit' ? context.pages()[0] ?? await context.newPage() : await context.newPage();
		await use(page);
	},
});

export { expect } from '@playwright/test';
