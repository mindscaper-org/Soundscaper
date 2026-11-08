/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { createMotionPreviewWorkerBackend, MotionPreviewWorkerUnavailableError } from '../src/common/editor/controller/composition/motion-preview-worker-backend.ts';
import { createMotionPreviewBackend } from '../src/common/editor/controller/composition/motion-preview-backend.ts';
import type { MotionPreviewWorkerPort, MotionPreviewWorkerRequest } from '../src/common/editor/motion-preview-worker-protocol.ts';
import type { MotionPreviewFrame } from '../src/common/editor/controller/composition/motion-preview-types.ts';
import { createMotionscaperProject } from '../src/motionscaper/editor-project.ts';

const project = createMotionscaperProject({ id: 'progress', title: 'Progress', compositionId: 'main', width: 16, height: 16 });
const frame: MotionPreviewFrame = { width: 16, height: 16, rgba: new Uint8ClampedArray(16 * 16 * 4), time: { num: 0, den: 1 }, compositionId: 'main', revision: 0, generation: 1, backend: 'worker-cpu' };
const request = { compositionId: 'main', time: { num: 0, den: 1 }, generation: 1 };
async function reactions(): Promise<void> { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); }

async function fixture(context: TestContext) {
	context.mock.timers.enable({ apis: ['setTimeout'] });
	const target = new EventTarget(); const sent: MotionPreviewWorkerRequest[] = []; let terminations = 0;
	const emit = (data: unknown) => target.dispatchEvent(new MessageEvent('message', { data }));
	const port: MotionPreviewWorkerPort = {
		postMessage(message) { sent.push(message); if (message.type === 'project') queueMicrotask(() => emit({ type: 'ready', requestId: message.requestId, backend: 'worker-cpu' })); },
		addEventListener(type, listener) { target.addEventListener(type, listener as EventListener); },
		removeEventListener(type, listener) { target.removeEventListener(type, listener as EventListener); },
		terminate() { terminations++; },
	};
	const backend = createMotionPreviewWorkerBackend(port, { maximumAssetBytes: 1024, maximumWorkingBytes: 1024 * 1024 });
	context.after(() => backend.dispose());
	await backend.setProject(project, () => Promise.reject(new Error('This project has no retained assets.')), new AbortController().signal);
	function start(signal = new AbortController().signal) {
		let settled = false;
		const outcome = backend.render(request, signal).then(value => { settled = true; return { ok: true as const, value }; }, (error: unknown) => { settled = true; return { ok: false as const, error }; });
		const id = [...sent].reverse().find(message => message.type === 'render')?.requestId;
		assert.ok(id);
		return { id, outcome, settled: () => settled };
	}
	return { backend, emit, sent, start, terminations: () => terminations,
		progress: (id: number, sequence: number, completedWork: number) => emit({ type: 'progress', requestId: id, sequence, completedWork }) };
}

test('Motion preview retains a progressing worker across the original thirty-second stall boundary', async context => {
	const f = await fixture(context); const render = f.start();
	context.mock.timers.tick(29_000); f.progress(render.id, 1, 100); await reactions();
	assert.equal(render.settled(), false, 'A work checkpoint is not a completed frame.');
	context.mock.timers.tick(29_000); f.progress(render.id, 2, 200); await reactions();
	assert.equal(render.settled(), false); assert.equal(f.terminations(), 0);
	f.emit({ type: 'frame', requestId: render.id, frame });
	assert.deepEqual(await render.outcome, { ok: true, value: frame });
});

test('Motion preview still terminates work that makes no progress for thirty seconds', async context => {
	const f = await fixture(context); const render = f.start(); context.mock.timers.tick(30_000);
	const outcome = await render.outcome; assert.equal(outcome.ok, false);
	if (outcome.ok) return;
	assert.ok(outcome.error instanceof MotionPreviewWorkerUnavailableError); assert.match(outcome.error.message, /30-second/u); assert.equal(f.terminations(), 1);
});

test('Motion preview expires thirty seconds after the last genuine checkpoint', async context => {
	const f = await fixture(context); const render = f.start();
	context.mock.timers.tick(29_000); f.progress(render.id, 1, 1); await reactions();
	context.mock.timers.tick(29_999); await reactions(); assert.equal(render.settled(), false);
	context.mock.timers.tick(1); const outcome = await render.outcome; assert.equal(outcome.ok, false);
	if (!outcome.ok) assert.ok(outcome.error instanceof MotionPreviewWorkerUnavailableError);
});

test('Motion preview retains its original project readiness deadline', async context => {
	context.mock.timers.enable({ apis: ['setTimeout'] }); const target = new EventTarget(); let terminations = 0;
	const backend = createMotionPreviewWorkerBackend({ postMessage() {}, terminate() { terminations++; },
		addEventListener(type, listener) { target.addEventListener(type, listener as EventListener); },
		removeEventListener(type, listener) { target.removeEventListener(type, listener as EventListener); } }, { maximumAssetBytes: 1024, maximumWorkingBytes: 1024 * 1024 });
	context.after(() => backend.dispose());
	const pending = backend.setProject(project, () => Promise.reject(new Error('No assets')), new AbortController().signal).catch((error: unknown) => error);
	context.mock.timers.tick(30_000); const error = await pending; assert.ok(error instanceof MotionPreviewWorkerUnavailableError); assert.equal(terminations, 1);
});

test('Motion preview ignores progress for another request without postponing the stall deadline', async context => {
	const f = await fixture(context); const render = f.start();
	context.mock.timers.tick(20_000); f.progress(render.id + 1, 1, 100); context.mock.timers.tick(10_000);
	const outcome = await render.outcome; assert.equal(outcome.ok, false);
	if (!outcome.ok) assert.ok(outcome.error instanceof MotionPreviewWorkerUnavailableError);
});

test('Motion preview rejects repeated or regressing work checkpoints instead of renewing them', async context => {
	const f = await fixture(context); const render = f.start();
	f.progress(render.id, 1, 100); await reactions(); assert.equal(render.settled(), false);
	f.progress(render.id, 2, 100);
	const outcome = await render.outcome; assert.equal(outcome.ok, false);
	if (!outcome.ok) assert.match(String(outcome.error), /invalid.*progress/iu);
	assert.equal(f.terminations(), 1);
});

test('Motion preview refuses a skipped progress sequence without accepting it as a frame', async context => {
	const f = await fixture(context); const render = f.start(); f.progress(render.id, 2, 100);
	const outcome = await render.outcome; assert.equal(outcome.ok, false);
	if (!outcome.ok) assert.match(String(outcome.error), /invalid.*progress/iu);
});

test('Motion preview refuses nonfinite or out-of-range completed work', async context => {
	const f = await fixture(context); const render = f.start(); f.progress(render.id, 1, Number.POSITIVE_INFINITY);
	const outcome = await render.outcome; assert.equal(outcome.ok, false);
	if (!outcome.ok) assert.match(String(outcome.error), /invalid.*progress/iu);
});

for (const [label, sequence, completedWork] of [['repeated sequence', 1, 200], ['negative work', 2, -1], ['fractional work', 2, 1.5], ['unsafe work', 2, Number.MAX_SAFE_INTEGER + 1]] as const) {
	test(`Motion preview refuses ${label}`, async context => {
		const f = await fixture(context); const render = f.start(); f.progress(render.id, 1, 100); await reactions();
		assert.equal(render.settled(), false); f.progress(render.id, sequence, completedWork);
		const outcome = await render.outcome; assert.equal(outcome.ok, false); if (!outcome.ok) assert.match(String(outcome.error), /invalid.*progress/iu);
	});
}

test('Motion preview bounds progress message traffic without retaining a growing history', async context => {
	const f = await fixture(context); const render = f.start();
	for (let sequence = 1; sequence <= 2401; sequence++) f.progress(render.id, sequence, sequence);
	await reactions(); assert.equal(render.settled(), false);
	f.progress(render.id, 2402, 2402); const outcome = await render.outcome; assert.equal(outcome.ok, false);
	if (!outcome.ok) assert.match(String(outcome.error), /invalid.*progress/iu);
	assert.equal(f.terminations(), 1);
});

test('Motion preview has a finite ten-minute frame limit even while work advances', async context => {
	const f = await fixture(context); const render = f.start();
	for (let sequence = 1; sequence <= 20; sequence++) {
		context.mock.timers.tick(29_000); f.progress(render.id, sequence, sequence * 100); await reactions();
		assert.equal(render.settled(), false);
	}
	context.mock.timers.tick(20_000);
	const outcome = await render.outcome; assert.equal(outcome.ok, false);
	if (outcome.ok) return;
	assert.ok(outcome.error instanceof Error); assert.equal(outcome.error.name, 'MotionPreviewRenderDeadlineError');
	assert.equal(outcome.error instanceof MotionPreviewWorkerUnavailableError, false, 'An exhausted frame must not select the host fallback.');
	assert.equal(f.terminations(), 1);
});

test('Motion preview cancellation settles promptly and drains the worker acknowledgement before reuse', async context => {
	const f = await fixture(context); const abort = new AbortController(); const render = f.start(abort.signal);
	abort.abort(); await reactions(); assert.equal(render.settled(), true);
	assert.ok(f.sent.some(message => message.type === 'cancel' && message.requestId === render.id));
	const outcome = await render.outcome; assert.equal(outcome.ok, false);
	if (!outcome.ok) assert.equal((outcome.error as Error).name, 'AbortError');
	const next = f.backend.render({ ...request, generation: 2 }, new AbortController().signal);
	const caught = next.then(value => ({ ok: true as const, value }), (error: unknown) => ({ ok: false as const, error }));
	await reactions(); assert.equal(f.sent.filter(message => message.type === 'render').length, 1);
	f.emit({ type: 'error', requestId: render.id, name: 'AbortError', message: 'Cancelled' }); await reactions();
	const id = [...f.sent].reverse().find(message => message.type === 'render')?.requestId; assert.ok(id && id !== render.id);
	f.progress(render.id, 1, 100); f.emit({ type: 'frame', requestId: id, frame: { ...frame, generation: 2 } });
	const completed = await caught; assert.equal(completed.ok, true); assert.equal(f.terminations(), 0);
});

test('Motion preview disposal closes a progressing request and leaves no deadline callbacks', async context => {
	const f = await fixture(context); const render = f.start(); f.progress(render.id, 1, 100); await reactions();
	assert.equal(render.settled(), false); f.backend.dispose();
	const outcome = await render.outcome; assert.equal(outcome.ok, false);
	if (!outcome.ok) assert.equal((outcome.error as Error).name, 'AbortError');
	context.mock.timers.tick(600_000); assert.equal(f.terminations(), 1);
});

test('Motion preview bounds cancellation acknowledgement and does not accept late progress as cleanup', async context => {
	const f = await fixture(context); const abort = new AbortController(); const render = f.start(abort.signal); abort.abort(); await reactions();
	const cancelled = await render.outcome; assert.equal(cancelled.ok, false);
	const next = f.backend.render({ ...request, generation: 2 }, new AbortController().signal).catch((error: unknown) => error); await reactions();
	context.mock.timers.tick(20_000); f.progress(render.id, 1, 100); context.mock.timers.tick(10_000);
	assert.ok(await next instanceof MotionPreviewWorkerUnavailableError); assert.equal(f.terminations(), 1);
});

test('Motion preview removes superseded replacement seeks while a cancellation drains', async context => {
	const f = await fixture(context); const abort = new AbortController(); const first = f.start(abort.signal); abort.abort(); await first.outcome;
	for (let generation = 2; generation <= 5; generation++) {
		const replacement = new AbortController();
		const pending = f.backend.render({ ...request, generation }, replacement.signal).catch((error: unknown) => error);
		replacement.abort(); assert.equal((await pending as Error).name, 'AbortError');
	}
	assert.equal(f.sent.filter(message => message.type === 'render').length, 1);
	f.emit({ type: 'error', requestId: first.id, name: 'AbortError', message: 'Cancelled' }); await reactions();
	const next = f.start(); f.emit({ type: 'frame', requestId: next.id, frame });
	assert.deepEqual(await next.outcome, { ok: true, value: frame }); assert.equal(f.terminations(), 0);
});

test('Motion preview gives cancelled work its bounded acknowledgement drain without reviving the frame', async context => {
	const f = await fixture(context); const abort = new AbortController(); const render = f.start(abort.signal);
	for (let sequence = 1; sequence <= 20; sequence++) { context.mock.timers.tick(29_000); f.progress(render.id, sequence, sequence); }
	context.mock.timers.tick(19_000); f.progress(render.id, 21, 21); abort.abort(); await reactions();
	const cancelled = await render.outcome; assert.equal(cancelled.ok, false);
	const next = f.backend.render({ ...request, generation: 2 }, new AbortController().signal);
	const caught = next.then(value => ({ ok: true as const, value }), (error: unknown) => ({ ok: false as const, error }));
	context.mock.timers.tick(2000); await reactions(); assert.equal(f.terminations(), 0);
	f.emit({ type: 'error', requestId: render.id, name: 'AbortError', message: 'Cancelled' }); await reactions();
	const id = [...f.sent].reverse().find(message => message.type === 'render')?.requestId; assert.ok(id && id !== render.id);
	f.emit({ type: 'frame', requestId: id, frame: { ...frame, generation: 2 } }); assert.equal((await caught).ok, true);
});

test('Motion preview recreates a worker for a later seek after absolute exhaustion', async context => {
	context.mock.timers.enable({ apis: ['setTimeout'] });
	const workers: { emit(data: unknown): void; sent: MotionPreviewWorkerRequest[] }[] = [];
	const prior = Object.getOwnPropertyDescriptor(globalThis, 'Worker');
	class WorkerPort {
		readonly target = new EventTarget(); readonly sent: MotionPreviewWorkerRequest[] = [];
		constructor() { workers.push({ sent: this.sent, emit: data => { this.target.dispatchEvent(new MessageEvent('message', { data })); } }); }
		postMessage(message: MotionPreviewWorkerRequest) { this.sent.push(message); if (message.type === 'project') queueMicrotask(() => this.target.dispatchEvent(new MessageEvent('message', { data: { type: 'ready', requestId: message.requestId, backend: 'worker-cpu' } }))); }
		addEventListener(type: string, listener: EventListener) { this.target.addEventListener(type, listener); }
		removeEventListener(type: string, listener: EventListener) { this.target.removeEventListener(type, listener); }
		terminate() {}
	}
	Object.defineProperty(globalThis, 'Worker', { value: WorkerPort, configurable: true });
	const backend = createMotionPreviewBackend({});
	context.after(() => { backend.dispose(); if (prior) Object.defineProperty(globalThis, 'Worker', prior); else Reflect.deleteProperty(globalThis, 'Worker'); });
	await backend.setProject(project, () => Promise.reject(new Error('No assets')), new AbortController().signal);
	const first = workers[0]; assert.ok(first);
	const firstOutcome = backend.render(request, new AbortController().signal).catch((error: unknown) => error); await reactions();
	const id = [...first.sent].reverse().find(message => message.type === 'render')?.requestId; assert.ok(id);
	for (let sequence = 1; sequence <= 20; sequence++) { context.mock.timers.tick(29_000); first.emit({ type: 'progress', requestId: id, sequence, completedWork: sequence }); await reactions(); }
	context.mock.timers.tick(20_000); assert.equal((await firstOutcome as Error).name, 'MotionPreviewRenderDeadlineError');
	const next = backend.render({ ...request, generation: 2 }, new AbortController().signal);
	const nextOutcome = next.then(value => ({ ok: true as const, value }), (error: unknown) => ({ ok: false as const, error }));
	await reactions(); await reactions(); assert.equal(workers.length, 2, 'The next seek should recover worker execution.');
	const replacement = workers[1]; assert.ok(replacement);
	const replacementId = [...replacement.sent].reverse().find(message => message.type === 'render')?.requestId; assert.ok(replacementId);
	replacement.emit({ type: 'frame', requestId: replacementId, frame: { ...frame, generation: 2 } });
	const outcome = await nextOutcome; assert.equal(outcome.ok, true); if (outcome.ok) assert.equal(outcome.value.backend, 'worker-cpu');
});
