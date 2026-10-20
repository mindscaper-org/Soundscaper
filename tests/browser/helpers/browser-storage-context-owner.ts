/* SPDX-License-Identifier: AGPL-3.0-only */

import type { Browser, BrowserContext, BrowserContextOptions, PlaywrightTestOptions, PlaywrightWorkerArgs, PlaywrightWorkerOptions, TestInfo } from '@playwright/test';
import { createContextVideo } from './browser-context-video.ts';

export type CreateBrowserContext = (options?: BrowserContextOptions) => Promise<BrowserContext>;

interface Environment {
	readonly playwright: PlaywrightWorkerArgs['playwright'];
	readonly browserName: PlaywrightWorkerOptions['browserName'];
	readonly getBrowser: () => Promise<Browser>;
	readonly storageState: PlaywrightTestOptions['storageState'];
	readonly video: PlaywrightWorkerOptions['video'];
	readonly testInfo: TestInfo;
}

/** Register this owner before open reflects options or starts a real browser. */
export function createBrowserStorageContextOwner(environment: Environment, ordinal: number) {
	let context: BrowserContext | undefined, persistentBrowser: Browser | undefined;
	let recording: ReturnType<typeof createContextVideo> | undefined;
	let settledOpen: Promise<void> = Promise.resolve();
	let closeWork: Promise<void> | undefined;
	let started = false, closing = false, openingFailed = false;
	const close = (): Promise<void> => {
		closing = true;
		closeWork ??= Promise.resolve().then(async () => {
			await settledOpen;
			const failures: unknown[] = [];
			let retired = context === undefined;
			if (context) {
				try {
					await context.close({ reason: environment.testInfo.status === 'timedOut'
						? `Test timeout of ${environment.testInfo.timeout}ms exceeded.` : 'Test ended.' });
					retired = true;
				} catch (error) { failures.push(error); }
			}
			// The caller may already have attempted context.close. Independently
			// join this exclusively owned persistent Browser even if that attempt
			// left the context in a closing state before its actual IPC close.
			if (persistentBrowser) {
				try { await persistentBrowser.close({ reason: 'Owned storage context ended.' }); retired = true; }
				catch (error) { retired = false; failures.push(error); }
			}
			try { await recording?.finish(retired, openingFailed || failures.length > 0); } catch (error) { failures.push(error); }
			if (failures.length > 1) throw new AggregateError(failures, 'Actual browser storage retirement failed.', { cause: failures[0] });
			if (failures.length) throw failures[0];
		});
		return closeWork;
	};
	return Object.freeze({
		open(options: BrowserContextOptions = {}): Promise<BrowserContext> {
			if (started || closing) throw new Error('The browser storage context has already opened or is retiring.');
			started = true;
			const opening = (async () => {
				recording = createContextVideo(environment.video, environment.testInfo, ordinal);
				const captured = { ...recording.options, ...options };
				const state = Object.hasOwn(captured, 'storageState') ? captured.storageState : environment.storageState;
				if (environment.browserName === 'webkit') {
					delete captured.storageState;
					context = await environment.playwright.webkit.launchPersistentContext('', captured);
					persistentBrowser = context.browser() ?? undefined;
					if (!persistentBrowser) throw new Error('The actual persistent context did not expose its owning Browser.');
					recording.attach(context);
					if (state !== undefined) await context.setStorageState(state);
				} else {
					context = await (await environment.getBrowser()).newContext(captured);
					recording.attach(context);
				}
				return context;
			})();
			settledOpen = opening.then(() => undefined, () => { openingFailed = true; });
			return opening.catch(async (primary: unknown) => {
				let cleanupFailed = false, cleanup: unknown;
				try { await close(); }
				catch (error) { cleanupFailed = true; cleanup = error; }
				if (cleanupFailed) throw new AggregateError([primary, cleanup], 'Browser storage opening and actual retirement failed.', { cause: primary });
				throw primary;
			});
		},
		close,
	});
}
