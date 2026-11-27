/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { JSDOM } from 'jsdom';

import type { TracktionProjectPage } from '../src/soundscaper/tracktion-project-contract.ts';
import { createTracktionWebBridge } from '../src/soundscaper/tracktion-web-bridge.ts';
import { deferred } from './helpers/async-test-control.ts';

type Request = Readonly<{ id: number; request: Readonly<{ kind: string; project?: string }> }>;

const project = {
	revision: 3, sampleRate: 48_000, canUndo: false, canRedo: false, nextOffset: null,
	tracks: [{ id: '3', name: 'Audio track', clipCount: 2 }],
} satisfies TracktionProjectPage;
const savedId = '4'.repeat(32);

class ProjectWorker extends EventTarget {
	readonly requests: string[] = [];
	terminated = false;
	releaseOnClose = false;

	postMessage({ id, request }: Request): void {
		assert.equal(this.terminated, false);
		this.requests.push(request.kind);
		if (request.kind === 'save') return;
		if (request.kind === 'open') assert.equal(request.project, savedId);
		const value = request.kind === 'projects' ? [{ id: savedId, name: 'Saved project' }] : project;
		const releaseEngine = request.kind === 'close' && this.releaseOnClose;
		queueMicrotask(() => this.dispatchEvent(new MessageEvent('message', { data: { id, value, releaseEngine } })));
	}

	terminate(): void { this.terminated = true; }
}

for (const releaseEngine of [true, false]) test(`closing a Tracktion project follows its worker retirement decision ${releaseEngine}`, async (context) => {
	browserFixture(context);
	const workers: ProjectWorker[] = [];
	const bridge = createTracktionWebBridge(() => {
		const worker = new ProjectWorker();
		worker.releaseOnClose = releaseEngine;
		workers.push(worker);
		return worker as unknown as Worker;
	});
	bridge.onProjectLost?.(() => assert.fail('Explicit Close must not report an unexpected project loss'));
	const opened = await bridge.request({ kind: 'create', sampleRate: 48_000 });
	assert.ok(opened);
	assert.equal(await bridge.request({ kind: 'close', sessionId: opened.sessionId }), null);
	assert.equal(workers[0]?.terminated, releaseEngine);
	await assert.rejects(bridge.request({ kind: 'project', sessionId: opened.sessionId, offset: 0 }), /expired/u);
	const next = await bridge.request({ kind: 'create', sampleRate: 48_000 });
	assert.ok(next);
	assert.equal(workers.length, releaseEngine ? 2 : 1);
	assert.deepEqual(await bridge.request({ kind: 'project', sessionId: next.sessionId, offset: 0 }), project);
});

function browserFixture(context: TestContext) {
	const { window } = new JSDOM('<!doctype html><body></body>');
	const chooser = deferred<HTMLDialogElement>();
	Object.defineProperty(window.HTMLDialogElement.prototype, 'showModal', {
		value(this: HTMLDialogElement) { this.open = true; chooser.resolve(this); },
	});
	const deadlines = new Map<number, () => void>();
	let sequence = 0;
	const bindings = {
		document: window.document,
		window: {
			prompt: () => 'Working project',
			setTimeout(callback: () => void): number {
				const id = ++sequence;
				deadlines.set(id, callback);
				return id;
			},
			clearTimeout(id: number): void { deadlines.delete(id); },
		},
	};
	installGlobals(context, bindings);
	context.after(() => window.close());
	return { window, deadlines, chooser: chooser.promise };
}

function installGlobals(context: TestContext, values: Readonly<Record<string, unknown>>): void {
	for (const [key, value] of Object.entries(values)) {
		const previous = Object.getOwnPropertyDescriptor(globalThis, key);
		Object.defineProperty(globalThis, key, { configurable: true, value });
		context.after(() => {
			if (previous) Object.defineProperty(globalThis, key, previous);
			else Reflect.deleteProperty(globalThis, key);
		});
	}
}

for (const cause of ['error', 'timeout', 'abort'] as const) test(`the browser can reopen a saved Tracktion project after worker ${cause}`, async (context) => {
	const { window, deadlines, chooser } = browserFixture(context);
	const workers: ProjectWorker[] = [];
	const bridge = createTracktionWebBridge(() => {
		const worker = new ProjectWorker();
		workers.push(worker);
		return worker as unknown as Worker;
	});
	const working = await bridge.request({ kind: 'create', sampleRate: 48_000 });
	assert.ok(working);
	const [first] = workers;
	assert.ok(first);
	const losses: { sessionId: string; message: string }[] = [];
	bridge.onProjectLost?.((sessionId, message) => { losses.push({ sessionId, message }); });
	const reason = cause === 'timeout' ? 'The Tracktion browser worker did not respond' : 'Tracktion ran out of memory';
	const saving = assert.rejects(bridge.request({ kind: 'save', sessionId: working.sessionId, revision: project.revision }), { message: reason });
	if (cause === 'error') first.dispatchEvent(Object.assign(new Event('error'), { message: reason }));
	else if (cause === 'abort') first.dispatchEvent(new MessageEvent('message', { data: { fatal: reason } }));
	else {
		const [deadline] = deadlines.values();
		assert.ok(deadline);
		deadline();
	}
	assert.equal(first.terminated, true);
	await saving;
	assert.equal(deadlines.size, 0);

	const reopening = bridge.request({ kind: 'open' });
	const dialog = await Promise.race([chooser, reopening.then(() => assert.fail('The saved project chooser never opened'))]);
	assert.equal(dialog.open, true);
	dialog.returnValue = savedId;
	dialog.dispatchEvent(new window.Event('close'));
	const reopened = await reopening;
	assert.ok(reopened);
	assert.equal(reopened.name, 'Saved project');
	assert.deepEqual(reopened.project, project);
	assert.deepEqual(workers[1]?.requests, ['projects', 'open']);
	assert.deepEqual(losses, [{ sessionId: working.sessionId, message: reason }]);
	await assert.rejects(bridge.request({ kind: 'project', sessionId: working.sessionId, offset: 0 }), /expired/u);

	// A queued late event cannot invalidate the replacement project.
	first.dispatchEvent(Object.assign(new Event('error'), { message: 'The previous worker stopped' }));
	assert.deepEqual(await bridge.request({ kind: 'project', sessionId: reopened.sessionId, offset: 0 }), project);
});

test('losing the browser worker closes an AudioContext that is still preparing playback', async (context) => {
	browserFixture(context);
	const worker = new ProjectWorker();
	const bridge = createTracktionWebBridge(() => worker as unknown as Worker);
	const working = await bridge.request({ kind: 'create', sampleRate: 48_000 });
	assert.ok(working);
	const worklet = deferred<void>();
	let closed = 0;
	class PendingAudioContext {
		readonly sampleRate = 48_000;
		readonly audioWorklet = { addModule: () => worklet.promise };
		resume(): Promise<void> { return Promise.resolve(); }
		close(): Promise<void> {
			closed += 1;
			worklet.reject(new Error('The audio context closed'));
			return Promise.resolve();
		}
	}
	installGlobals(context, { AudioContext: PendingAudioContext });
	const preparing = assert.rejects(bridge.request({ kind: 'prepareOutput', sessionId: working.sessionId }), /worker stopped/u);
	worker.dispatchEvent(Object.assign(new Event('error'), { message: 'The browser worker stopped' }));
	await preparing;
	assert.equal(closed, 1);
});
