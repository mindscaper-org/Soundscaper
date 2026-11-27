/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { JSDOM } from 'jsdom';

import type { TracktionProjectPage, TracktionTransportObservation } from '../src/soundscaper/tracktion-project-contract.ts';
import { createTracktionWebBridge } from '../src/soundscaper/tracktion-web-bridge.ts';
import { openTracktionProjectDatabase, tracktionProjectStores } from '../src/soundscaper/tracktion-web-project-library.ts';
import { deferred } from './helpers/async-test-control.ts';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';

type Request = Readonly<{ id: number; request: Readonly<{ kind: string; project?: string; name?: string }> }>;

const project = {
	revision: 3, sampleRate: 48_000, canUndo: false, canRedo: false, nextOffset: null,
	tracks: [{ id: '3', name: 'Audio track', clipCount: 2 }],
} satisfies TracktionProjectPage;
const savedId = '4'.repeat(32);

class ProjectWorker extends EventTarget {
	readonly requests: string[] = [];
	readonly importedNames: string[] = [];
	readonly refusals = new Map<string, string>();
	terminated = false;
	releaseOnClose = false;
	openingTransport: TracktionTransportObservation | undefined;

	postMessage({ id, request }: Request): void {
		assert.equal(this.terminated, false);
		this.requests.push(request.kind);
		const refusal = this.refusals.get(request.kind);
		if (refusal) {
			queueMicrotask(() => this.dispatchEvent(new MessageEvent('message', { data: { id, error: 'request', detail: refusal } })));
			return;
		}
		if (request.kind === 'save') return;
		if (request.kind === 'open') assert.equal(request.project, savedId);
		if (request.kind === 'importFile') {
			assert.ok(request.name !== undefined);
			this.importedNames.push(request.name);
		}
		const releaseEngine = request.kind === 'close' && this.releaseOnClose;
		const recording = request.kind === 'startRecording';
		const playing = request.kind === 'play' || request.kind === 'seek' || recording;
		const transport = playing || request.kind === 'prepareOutput' || request.kind === 'stop';
		const value = transport ? { ready: true, playing, recording, frame: 0 }
			: request.kind === 'finishRecording' ? { revision: project.revision, itemId: null } : project;
		const warmed = request.kind === 'create' ? this.openingTransport : undefined;
		queueMicrotask(() => this.dispatchEvent(new MessageEvent('message', { data: { id, value, releaseEngine, transport: warmed } })));
	}

	terminate(): void { this.terminated = true; }
}

test('the browser bridge returns the transport already read by the project worker', async (context) => {
	browserFixture(context);
	const worker = new ProjectWorker();
	worker.openingTransport = { playing: false, recording: false, frame: 0 };
	const bridge = createTracktionWebBridge(() => worker as unknown as Worker);
	const opened = await bridge.request({ kind: 'create', sampleRate: 48_000 });
	assert.deepEqual(opened?.transport, worker.openingTransport);
	assert.deepEqual(worker.requests, ['create']);
});

for (const suspensionFails of [false, true]) test(`Stop retains its transport reply and Play reuses audio when suspension fails ${suspensionFails}`, async (context) => {
	browserFixture(context);
	const worker = new ProjectWorker();
	const bridge = createTracktionWebBridge(() => worker as unknown as Worker);
	const opened = await bridge.request({ kind: 'create', sampleRate: 48_000 });
	assert.ok(opened);
	const suspendRequested = deferred<void>();
	const finishSuspend = deferred<void>();
	let loaded = 0;
	let disconnected = 0;
	let connected = 0;
	const contexts: PlaybackContext[] = [];
	class PlaybackContext {
		readonly sampleRate = 48_000;
		readonly destination = {};
		readonly audioWorklet = { addModule: () => { loaded += 1; return Promise.resolve(); } };
		state: AudioContextState = 'suspended';
		constructor() { contexts.push(this); }
		resume(): Promise<void> { this.state = 'running'; return Promise.resolve(); }
		async suspend(): Promise<void> {
			suspendRequested.resolve();
			await finishSuspend.promise;
			this.state = 'suspended';
		}
	}
	class PlaybackNode {
		readonly port = { close() {} };
		connect(): void { connected += 1; }
		disconnect(): void { disconnected += 1; }
	}
	installGlobals(context, { AudioContext: PlaybackContext, AudioWorkletNode: PlaybackNode });
	const { sessionId } = opened;
	await bridge.request({ kind: 'prepareOutput', sessionId });
	await bridge.request({ kind: 'play', sessionId, frame: 0 });
	assert.equal(contexts[0]?.state, 'running');
	const stopped = bridge.request({ kind: 'stop', sessionId });
	await Promise.race([suspendRequested.promise, stopped.then(() => assert.fail('Stop completed before suspending audio'))]);
	assert.equal(disconnected, 1);
	if (suspensionFails) finishSuspend.reject(new Error('The browser could not suspend its audio context'));
	else finishSuspend.resolve();
	assert.equal((await stopped).playing, false);
	assert.equal(contexts[0]?.state, suspensionFails ? 'running' : 'suspended');
	await bridge.request({ kind: 'prepareOutput', sessionId });
	await bridge.request({ kind: 'play', sessionId, frame: 0 });
	assert.equal(contexts[0]?.state, 'running');
	assert.equal(contexts.length, 1);
	assert.equal(loaded, 1);
	assert.equal(connected, 2);
});

test('a refused Play suspends idle browser audio and leaves active playback and capture alone', async (context) => {
	browserFixture(context);
	const worker = new ProjectWorker();
	const bridge = createTracktionWebBridge(() => worker as unknown as Worker);
	const opened = await bridge.request({ kind: 'create', sampleRate: 48_000 });
	assert.ok(opened);
	const contexts: PlaybackContext[] = [];
	let suspended = 0;
	let disconnected = 0;
	let stoppedTracks = 0;
	const microphone = Object.assign(new EventTarget(), { readyState: 'live', stop() { stoppedTracks += 1; } });
	class PlaybackContext {
		readonly sampleRate = 48_000;
		readonly destination = {};
		readonly audioWorklet = { addModule: () => Promise.resolve() };
		state: AudioContextState = 'suspended';
		constructor() { contexts.push(this); }
		resume(): Promise<void> { this.state = 'running'; return Promise.resolve(); }
		suspend(): Promise<void> {
			suspended += 1;
			this.state = 'suspended';
			return Promise.resolve();
		}
		createMediaStreamSource() { return { connect() {}, disconnect() {} }; }
	}
	class PlaybackNode extends EventTarget {
		readonly port = { close() {} };
		connect(): void {}
		disconnect(): void { disconnected += 1; }
	}
	installGlobals(context, {
		AudioContext: PlaybackContext, AudioWorkletNode: PlaybackNode,
		navigator: { mediaDevices: { getUserMedia: () => Promise.resolve({ getTracks: () => [microphone], getAudioTracks: () => [microphone] }) } },
	});
	const { sessionId } = opened;
	const play = { kind: 'play', sessionId, frame: 0 } as const;
	const prepare = { kind: 'prepareOutput', sessionId } as const;
	const reason = 'This Tracktion Edit has an effect that requires offline rendering';
	await bridge.request(prepare);
	const [audioContext] = contexts;
	assert.ok(audioContext);
	assert.equal(audioContext.state, 'running');
	worker.refusals.set('play', reason);
	await assert.rejects(bridge.request(play), { message: reason });
	assert.equal(audioContext.state, 'suspended');
	assert.equal(suspended, 1);
	assert.deepEqual(worker.requests, ['create', 'prepareOutput', 'play']);

	worker.refusals.delete('play');
	await bridge.request(prepare);
	assert.equal((await bridge.request(play)).playing, true);
	assert.equal(contexts.length, 1);
	worker.refusals.set('seek', 'Cannot seek while the edit is changing');
	await assert.rejects(bridge.request({ kind: 'seek', sessionId, frame: 512 }), { message: 'Cannot seek while the edit is changing' });
	assert.equal(audioContext.state, 'running');
	assert.equal(suspended, 1);
	assert.equal(disconnected, 0);

	await bridge.request({ kind: 'stop', sessionId });
	await bridge.request({ kind: 'startRecording', sessionId, revision: project.revision, trackId: '3', frame: 0 });
	worker.refusals.set('play', 'Finish or discard the Tracktion recording first');
	await assert.rejects(bridge.request(play), { message: 'Finish or discard the Tracktion recording first' });
	assert.equal(audioContext.state, 'running');
	assert.equal(suspended, 2);
	assert.equal(disconnected, 1);
	assert.equal(stoppedTracks, 0);
	await bridge.request({ kind: 'finishRecording', sessionId, revision: project.revision, discard: true });
	assert.equal(stoppedTracks, 1);
});

test('WAV imports preserve nonempty native names within the UTF-8 byte limit', async (context) => {
	const { window } = browserFixture(context);
	const worker = new ProjectWorker();
	const bridge = createTracktionWebBridge(() => worker as unknown as Worker);
	const opened = await bridge.request({ kind: 'create', sampleRate: 48_000 });
	assert.ok(opened);
	let file: File;
	context.mock.method(window.HTMLInputElement.prototype, 'click', function (this: HTMLInputElement): void {
		Object.defineProperty(this, 'files', { value: [file] });
		this.dispatchEvent(new window.Event('change'));
	});
	const unicodePrefix = '界'.repeat(170);
	const existingName = `${'a'.repeat(200)}🔊`;
	for (const name of ['.wav', `${unicodePrefix}🔊 and take.wav`, `${existingName}.WAV`]) {
		file = new File([Uint8Array.of(1, 2, 3)], name, { type: 'audio/wav' });
		await bridge.request({ kind: 'import', sessionId: opened.sessionId, revision: project.revision, trackId: '3', start: 0 });
	}
	assert.deepEqual(worker.importedNames, ['.wav', unicodePrefix, existingName]);
});

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

async function seedSavedProject(context: TestContext, entries: Readonly<Record<string, unknown>> = {
	[savedId]: { name: 'Saved project', generation: 2, updated: 321 },
}): Promise<void> {
	const storage = createInstrumentedIndexedDB();
	installGlobals(context, { indexedDB: storage });
	const db = await openTracktionProjectDatabase();
	for (const [id, metadata] of Object.entries(entries)) storage.seedRecord(db.name, tracktionProjectStores[1], metadata, id);
	db.close();
}

for (const selected of [false, true]) test(`the project chooser starts the Tracktion worker only after a saved project is selected ${selected}`, async (context) => {
	const { chooser, window } = browserFixture(context);
	await seedSavedProject(context);
	const workers: ProjectWorker[] = [];
	const bridge = createTracktionWebBridge(() => {
		const worker = new ProjectWorker();
		workers.push(worker);
		return worker as unknown as Worker;
	});
	const opening = bridge.request({ kind: 'open' });
	const dialog = await Promise.race([chooser, opening.then(() => assert.fail('The saved project chooser never opened'))]);
	assert.equal(workers.length, 0);
	assert.match(dialog.textContent, /Saved project/u);
	dialog.returnValue = selected ? savedId : '';
	dialog.dispatchEvent(new window.Event('close'));
	const opened = await opening;
	if (!selected) {
		assert.equal(opened, null);
		assert.equal(workers.length, 0);
		return;
	}
	assert.equal(opened?.name, 'Saved project');
	assert.deepEqual(opened?.project, project);
	assert.deepEqual(workers[0]?.requests, ['open']);
});

test('same-name saved Edits have distinguishable chooser labels and keep their own identity', async (context) => {
	const { chooser, window } = browserFixture(context);
	window.document.documentElement.lang = 'en-GB';
	const date = Date.UTC(2026, 10, 27, 12);
	const record = (name: string, updated: number) => ({ name, generation: 2, updated });
	await seedSavedProject(context, {
		[savedId]: record('Same name', date),
		['5'.repeat(32)]: record('Same name', date - 24 * 60 * 60 * 1000),
		['6'.repeat(32)]: record('Same name', date),
		['7'.repeat(32)]: 2,
		['8'.repeat(32)]: 3,
		['9'.repeat(32)]: record('Unique name', date),
		['a'.repeat(32)]: record('Cancel', date),
	});
	const worker = new ProjectWorker();
	const bridge = createTracktionWebBridge(() => worker as unknown as Worker);
	const opening = bridge.request({ kind: 'open' });
	const dialog = await Promise.race([chooser, opening.then(() => assert.fail('The saved project chooser never opened'))]);
	const buttons = [...dialog.querySelectorAll<HTMLButtonElement>('button')];
	assert.equal(new Set(buttons.map((button) => button.textContent)).size, buttons.length);
	const latest = buttons.find((button) => button.value === savedId);
	const formatted = new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'medium' }).format(date);
	assert.ok(latest);
	assert.ok(latest.textContent?.includes(formatted));
	assert.equal(buttons.find((button) => button.value === '9'.repeat(32))?.textContent, 'Unique name');
	assert.equal(buttons.at(-1)?.textContent, 'Cancel');
	assert.deepEqual(worker.requests, []);

	dialog.returnValue = latest.value;
	dialog.dispatchEvent(new window.Event('close'));
	assert.equal((await opening)?.name, 'Same name');
	assert.deepEqual(worker.requests, ['open']);
});

for (const cause of ['error', 'timeout', 'abort'] as const) test(`the browser can reopen a saved Tracktion project after worker ${cause}`, async (context) => {
	const { window, deadlines, chooser } = browserFixture(context);
	await seedSavedProject(context);
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
	assert.deepEqual(workers[1]?.requests, ['open']);
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
