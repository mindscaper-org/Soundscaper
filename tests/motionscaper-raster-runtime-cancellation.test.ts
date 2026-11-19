/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { getEventListeners } from 'node:events';
import test from 'node:test';
import { createMotionRasterRuntimeLoader } from '../src/common/editor/controller/composition/motion-raster-runtime.ts';
import type { MotionRasterRuntime } from '../src/common/editor/motion-canvaskit-browser.ts';

const runtime: MotionRasterRuntime = { kit: {} as MotionRasterRuntime['kit'], fallbackFonts: [] };
const turn = () => new Promise<void>((resolve) => setImmediate(resolve));

function deferred<Value>() {
	let resolve!: (value: Value) => void;
	let reject!: (error: unknown) => void;
	const promise = new Promise<Value>((yes, no) => { resolve = yes; reject = no; });
	return { promise, resolve, reject };
}

function observe<Value>(promise: Promise<Value>) {
	const result: { settled: PromiseSettledResult<Value> | null } = { settled: null };
	const done = promise.then(
		(value) => { result.settled = { status: 'fulfilled', value }; },
		(reason: unknown) => { result.settled = { status: 'rejected', reason }; },
	);
	return { result, done };
}

test('Motion raster cancellation settles before shared initialization and preserves surviving consumers', async () => {
	const gate = deferred<MotionRasterRuntime>(); let calls = 0;
	const load = createMotionRasterRuntimeLoader(() => { calls++; return gate.promise; });
	const cancellation = new AbortController();
	const cancelled = observe(load(cancellation.signal)); const survivor = observe(load());
	try {
		assert.equal(calls, 1);
		cancellation.abort(); await turn();
		assert.equal(cancelled.result.settled?.status, 'rejected', 'Cancellation must settle while shared initialization remains pending.');
		assert.deepEqual(cancelled.result.settled, { status: 'rejected', reason: cancellation.signal.reason });
		assert.equal(survivor.result.settled, null);
		assert.equal(getEventListeners(cancellation.signal, 'abort').length, 0);
		const later = observe(load()); assert.equal(calls, 1, 'A cancelled consumer must not reset shared initialization.');
		gate.resolve(runtime); await later.done;
		assert.deepEqual(later.result.settled, { status: 'fulfilled', value: runtime });
	} finally { gate.resolve(runtime); await Promise.all([cancelled.done, survivor.done]); }
	assert.deepEqual(survivor.result.settled, { status: 'fulfilled', value: runtime });
	assert.equal(await load(), runtime); assert.equal(calls, 1);
});

test('Motion raster late initialization failure is observed after consumer cancellation and permits retry', async () => {
	const gate = deferred<MotionRasterRuntime>(); let calls = 0;
	const failure = new Error('Runtime download failed after cancellation.');
	const load = createMotionRasterRuntimeLoader(() => ++calls === 1 ? gate.promise : Promise.resolve(runtime));
	const cancellation = new AbortController(); const cancelled = observe(load(cancellation.signal));
	try {
		cancellation.abort(); await turn();
		assert.deepEqual(cancelled.result.settled, { status: 'rejected', reason: cancellation.signal.reason });
	} finally { gate.reject(failure); await cancelled.done; await turn(); }
	assert.deepEqual(cancelled.result.settled, { status: 'rejected', reason: cancellation.signal.reason });
	assert.equal(getEventListeners(cancellation.signal, 'abort').length, 0);
	assert.equal(await load(), runtime); assert.equal(calls, 2);
});

test('Motion raster cancellation during initializer setup still observes its later rejection', async () => {
	const gate = deferred<MotionRasterRuntime>(); const cancellation = new AbortController(); let calls = 0;
	const load = createMotionRasterRuntimeLoader(() => {
		if (++calls > 1) return Promise.resolve(runtime);
		cancellation.abort(); return gate.promise;
	});
	const cancelled = observe(load(cancellation.signal)); await cancelled.done;
	assert.deepEqual(cancelled.result.settled, { status: 'rejected', reason: cancellation.signal.reason });
	gate.reject(new Error('Runtime setup failed after synchronous cancellation.')); await turn();
	assert.equal(await load(), runtime); assert.equal(calls, 2);
	assert.equal(getEventListeners(cancellation.signal, 'abort').length, 0);
});

test('Motion raster pre-aborted consumers never initialize or disturb an existing shared load', async () => {
	const gate = deferred<MotionRasterRuntime>(); let calls = 0;
	const load = createMotionRasterRuntimeLoader(() => { calls++; return gate.promise; });
	const cancellation = new AbortController(); cancellation.abort();
	await assert.rejects(load(cancellation.signal), { name: 'AbortError' }); assert.equal(calls, 0);
	const survivor = load();
	try {
		await assert.rejects(load(cancellation.signal), { name: 'AbortError' }); assert.equal(calls, 1);
	} finally { gate.resolve(runtime); }
	assert.equal(await survivor, runtime);
	assert.equal(getEventListeners(cancellation.signal, 'abort').length, 0);
});

test('Motion raster successful consumers release abort listeners and late abort leaves the cached runtime intact', async () => {
	const gate = deferred<MotionRasterRuntime>(); let calls = 0;
	const load = createMotionRasterRuntimeLoader(() => { calls++; return gate.promise; });
	const cancellation = new AbortController(); const pending = load(cancellation.signal);
	gate.resolve(runtime); assert.equal(await pending, runtime);
	assert.equal(getEventListeners(cancellation.signal, 'abort').length, 0);
	cancellation.abort(); assert.equal(await load(), runtime); assert.equal(calls, 1);
});

test('Motion raster failed consumers release abort listeners and retry shares one fresh initialization', async () => {
	const first = deferred<MotionRasterRuntime>(); const retry = deferred<MotionRasterRuntime>(); let calls = 0;
	const load = createMotionRasterRuntimeLoader(() => ++calls === 1 ? first.promise : retry.promise);
	const cancellation = new AbortController(); const pending = observe(load(cancellation.signal));
	const failure = new Error('Offline runtime unavailable.'); first.reject(failure); await pending.done;
	assert.deepEqual(pending.result.settled, { status: 'rejected', reason: failure });
	assert.equal(getEventListeners(cancellation.signal, 'abort').length, 0);
	const survivor = load(); const another = load(); assert.equal(calls, 2);
	retry.resolve(runtime); assert.deepEqual(await Promise.all([survivor, another]), [runtime, runtime]);
});
