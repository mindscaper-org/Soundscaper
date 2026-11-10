/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';

import { scheduleOfflineApplicationShellRegistration } from '../src/common/offline/application-shell.ts';

function installGlobals(context: TestContext, values: Readonly<Record<string, unknown>>): void {
	for (const [key, value] of Object.entries(values)) {
		const previous = Object.getOwnPropertyDescriptor(globalThis, key);
		context.after(() => {
			if (previous) Object.defineProperty(globalThis, key, previous);
			else Reflect.deleteProperty(globalThis, key);
		});
		Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
	}
}

function registrationFixture() {
	const calls: unknown[][] = [];
	const registration = { scope: 'https://soundscaper.org/' };
	return {
		calls,
		registration,
		options: {
			desktop: false,
			productId: 'soundscaper' as const,
			location: new URL('https://soundscaper.org/en/'),
			serviceWorker: {
				register: (...args: unknown[]) => {
					calls.push(args);
					return Promise.resolve(registration);
				},
			},
		},
	};
}

async function flushTasks(): Promise<void> {
	await new Promise<void>((resolve) => setImmediate(resolve));
}

test('default scheduling waits for document load, editor readiness, and browser idle', async (context) => {
	const windowEvents = new EventTarget();
	let ready = false;
	let observed = false;
	let disconnected = false;
	let notifyMutation: () => void = () => assert.fail('the editor observer was not installed');
	let notifyIdle: () => void = () => assert.fail('an idle callback was not requested');
	let idleRequested = false;
	const root = {
		querySelector: (selector: string) => {
			assert.match(selector, /\[data-audio-editor-bound="true"\]/u);
			return ready ? {} : null;
		},
	};
	installGlobals(context, {
		document: {
			readyState: 'loading',
			getElementById: (id: string) => { assert.equal(id, 'app'); return root; },
		},
		addEventListener: (type: string, listener: EventListener, options: AddEventListenerOptions) => {
			assert.equal(type, 'load');
			assert.deepEqual(options, { once: true });
			windowEvents.addEventListener(type, listener, options);
		},
		MutationObserver: class {
			constructor(callback: () => void) { notifyMutation = callback; }
			observe(target: unknown, options: MutationObserverInit): void {
				assert.equal(target, root);
				assert.deepEqual(options, { childList: true, subtree: true });
				observed = true;
			}
			disconnect(): void { disconnected = true; }
		},
		requestIdleCallback: (callback: () => void, options: { timeout: number }) => {
			assert.equal(disconnected, true, 'editor observation ends before idle scheduling');
			assert.deepEqual(options, { timeout: 5_000 });
			idleRequested = true;
			notifyIdle = callback;
			return 1;
		},
	});
	const fixture = registrationFixture();
	const scheduled = scheduleOfflineApplicationShellRegistration(fixture.options);
	await flushTasks();
	assert.equal(observed, false, 'editor readiness is not observed before load');
	assert.deepEqual(fixture.calls, []);

	windowEvents.dispatchEvent(new Event('load'));
	await flushTasks();
	assert.equal(observed, true);
	notifyMutation();
	await flushTasks();
	assert.equal(disconnected, false, 'unrelated DOM mutations keep the readiness gate pending');
	assert.equal(idleRequested, false);
	assert.deepEqual(fixture.calls, []);

	ready = true;
	notifyMutation();
	await flushTasks();
	assert.equal(disconnected, true);
	assert.equal(idleRequested, true);
	assert.deepEqual(fixture.calls, [], 'readiness alone must not start the shell download');

	notifyIdle();
	assert.deepEqual(await scheduled, { status: 'registered', registration: fixture.registration });
	assert.deepEqual(fixture.calls, [[
		'/service-worker.js',
		{ scope: '/', type: 'classic', updateViaCache: 'none' },
	]]);
});

for (const rootPresent of [true, false]) {
	test(`default scheduling uses the timer fallback for a loaded document with ${rootPresent ? 'a ready editor' : 'no editor root'}`, async (context) => {
		context.mock.timers.enable({ apis: ['setTimeout'] });
		installGlobals(context, {
			document: {
				readyState: 'complete',
				getElementById: () => rootPresent ? { querySelector: () => ({}) } : null,
			},
			addEventListener: () => assert.fail('a loaded document must not wait for another load event'),
			MutationObserver: class {
				constructor() { assert.fail('a ready or absent root needs no observation'); }
			},
			requestIdleCallback: undefined,
		});
		const fixture = registrationFixture();
		const scheduled = scheduleOfflineApplicationShellRegistration(fixture.options);
		await flushTasks();
		assert.deepEqual(fixture.calls, []);
		context.mock.timers.tick(999);
		await flushTasks();
		assert.deepEqual(fixture.calls, [], 'the fallback keeps registration out of the initial turn');
		context.mock.timers.tick(1);
		assert.deepEqual(await scheduled, { status: 'registered', registration: fixture.registration });
		assert.equal(fixture.calls.length, 1);
	});
}
