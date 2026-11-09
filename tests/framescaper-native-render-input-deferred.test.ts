/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createDeferredFramescaperNativeRenderInputStreamProducer } from '../src/framescaper/editor-native-render-input-deferred.ts';
import { FRAMESCAPER_PROJECT_RUNTIME_PROFILE as PROFILE } from '../src/framescaper/editor-project-runtime-profile.ts';
import type { ProductNativeRenderInputOperation } from '../src/common/editor/controller/composition/product-native-render-input-authority.ts';

const request = () => ({ planPayload: '{}', planFingerprint: 'ab'.repeat(32), projectId: 'project', projectRevision: 3 });

function fixture() {
	let current = true, begun = 0, finished = 0;
	const abort = new AbortController();
	const authority = { authority: { begin: () => {
		begun++;
		return { signal: abort.signal, assertCurrent() {
			if (!current) throw new Error('stale owner');
		}, finish() { finished++; } } as ProductNativeRenderInputOperation;
	} }, store: { loadMediaAsset: async () => null } };
	return { authority, cancel() { abort.abort(new Error('cancelled render')); }, retire() { current = false; }, get begun() { return begun; }, get finished() { return finished; } };
}

function gate<Value>() {
	let resolve!: (value: Value) => void;
	const promise = new Promise<Value>(accept => { resolve = accept; });
	return { promise, resolve };
}

test('native rendering stays unloaded until requested and concurrent calls share initialization', async () => {
	const owner = fixture(), loaded = gate<void>();
	let loads = 0, calls = 0;
	const seen: unknown[] = [];
	const stream = { carrierByteLength: 64, audio: null, stream: async () => ({ byteLength: 64, sha256: '', chunkCount: 1 }) };
	const produce = createDeferredFramescaperNativeRenderInputStreamProducer(PROFILE, owner.authority, undefined, async () => {
		loads++;
		await loaded.promise;
		return () => async (value) => { calls++; seen.push(value); return stream; };
	});
	assert.equal(loads, 0);
	assert.equal(owner.begun, 0);
	const mutable = request();
	const first = produce(mutable), second = produce(request());
	mutable.projectRevision = 4;
	assert.equal(calls, 0);
	loaded.resolve();
	assert.deepEqual(await Promise.all([first, second]), [stream, stream]);
	assert.equal(loads, 1);
	assert.equal(calls, 2);
	assert.equal((seen[0] as ReturnType<typeof request>).projectRevision, 3);
	assert.ok(Object.isFrozen(seen[0]));
	assert.equal(owner.finished, owner.begun);
	assert.equal(await produce(request()), stream);
	assert.equal(loads, 1);
});

test('a project retired while loading cannot start native rendering', async () => {
	const owner = fixture(), loaded = gate<void>();
	let calls = 0;
	const produce = createDeferredFramescaperNativeRenderInputStreamProducer(PROFILE, owner.authority, undefined, async () => {
		await loaded.promise;
		return () => async () => { calls++; throw new Error('must not render'); };
	});
	const result = produce(request());
	owner.retire();
	loaded.resolve();
	await assert.rejects(result, /stale owner/u);
	assert.equal(calls, 0);
	assert.equal(owner.finished, owner.begun);
});

test('load failure releases the request lease and permits a later retry', async () => {
	const owner = fixture();
	let loads = 0;
	const produce = createDeferredFramescaperNativeRenderInputStreamProducer(PROFILE, owner.authority, undefined, () => {
		loads++;
		return Promise.reject(new Error('chunk unavailable'));
	});
	await assert.rejects(produce(request()), /chunk unavailable/u);
	await assert.rejects(produce(request()), /chunk unavailable/u);
	assert.equal(loads, 2);
	assert.equal(owner.finished, owner.begun);
});

test('invalid authority, profile and request never load native rendering', async () => {
	const owner = fixture();
	let loads = 0;
	const load = async () => { loads++; throw new Error('must not load'); };
	assert.throws(() => createDeferredFramescaperNativeRenderInputStreamProducer({}, owner.authority, undefined, load), TypeError);
	assert.throws(() => createDeferredFramescaperNativeRenderInputStreamProducer(PROFILE, {} as never, undefined, load), TypeError);
	const produce = createDeferredFramescaperNativeRenderInputStreamProducer(PROFILE, owner.authority, undefined, load);
	await assert.rejects(produce({ ...request(), projectRevision: -1 }), TypeError);
	assert.equal(loads, 0);
	assert.equal(owner.begun, 0);
});


test('cancellation during native chunk loading releases the lease without rendering', async () => {
	const owner = fixture(), loaded = gate<void>();
	let calls = 0;
	const produce = createDeferredFramescaperNativeRenderInputStreamProducer(PROFILE, owner.authority, undefined, async () => {
		await loaded.promise;
		return () => async () => { calls++; throw new Error('must not render'); };
	});
	const result = produce(request());
	owner.cancel();
	loaded.resolve();
	await assert.rejects(result, /cancelled render/u);
	assert.equal(calls, 0);
	assert.equal(owner.finished, owner.begun);
});

test('loading and lease-cleanup failures retain both causes', async () => {
	const owner = fixture();
	const primary = new Error('load failed'), cleanup = new Error('lease failed');
	const begin = owner.authority.authority.begin;
	owner.authority.authority.begin = () => {
		const operation = begin();
		return { ...operation, finish() { operation.finish(); throw cleanup; } };
	};
	const produce = createDeferredFramescaperNativeRenderInputStreamProducer(PROFILE, owner.authority, undefined, () => Promise.reject(primary));
	await assert.rejects(produce(request()), (error: unknown) => {
		assert.ok(error instanceof AggregateError);
		assert.equal(error.cause, primary);
		assert.deepEqual(error.errors, [primary, cleanup]);
		return true;
	});
	assert.equal(owner.finished, owner.begun);
});
