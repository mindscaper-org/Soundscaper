/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { LightscaperDesktopLifecycle, type LightscaperDesktopLifecycleBridge, type LightscaperDesktopLifecycleOptions,
	type LightscaperDesktopCloseResponse, type LightscaperDesktopCloseSafety } from '../src/common/editor/controller/composition/lightscaper-desktop-lifecycle.ts';
import { deferred, settle } from './helpers/async-test-control.ts';

function fixture(overrides: Partial<LightscaperDesktopLifecycleOptions> = {}) {
	const responses: LightscaperDesktopCloseResponse[] = [], errors: unknown[] = [], vetoes: string[] = [];
	let listener: ((request: unknown) => void) | null = null;
	const state = { mounted: true, safety: 'ready' as LightscaperDesktopCloseSafety, ready: 0, fences: 0, retirements: 0, cleanups: 0 };
	const bridge: LightscaperDesktopLifecycleBridge = {
		signalReady() { assert.equal(this, bridge); state.ready++; },
		onCloseRequested(callback) { assert.equal(this, bridge); listener = callback; return () => { state.cleanups++; }; },
		respondToClose(response) { assert.equal(this, bridge); responses.push(response); },
	};
	const owner = new LightscaperDesktopLifecycle({ bridge, isMounted: () => state.mounted,
		closeSafety: () => state.safety, fence: () => { state.fences++; }, retireAndJoin: async () => { state.retirements++; },
		reportError: error => { errors.push(error); }, reportVeto: reason => { vetoes.push(reason); }, ...overrides });
	return { owner, bridge, state, responses, errors, vetoes,
		request(value: unknown) { assert.ok(listener); listener(value); },
		close(requestId = 'request-1') { assert.ok(listener); listener({ requestId, reason: 'window-close' }); } };
}

test('Lightscaper readiness belongs to a live mounted effect and subscription cleanup is idempotent', async () => {
	const f = fixture(); assert.equal(f.state.ready, 0);
	const mounted = f.owner.mount(); assert.equal(f.owner.mount(), mounted);
	await mounted; assert.equal(f.state.ready, 1);
	const disposal = f.owner.dispose(); assert.equal(f.owner.dispose(), disposal); await disposal;
	f.close(); await settle(); assert.equal(f.responses.length, 0); assert.equal(f.state.cleanups, 1);
});

test('the StrictMode probe and a detached mount never signal renderer-ready', async () => {
	const probe = fixture(); const pending = probe.owner.mount(); await probe.owner.dispose(); await pending;
	assert.equal(probe.state.ready, 0);
	const detached = fixture(); detached.state.mounted = false; await detached.owner.mount();
	assert.equal(detached.state.ready, 0); await detached.owner.dispose();
});

for (const safety of ['busy', 'open-surface'] as const) test(`OS close veto preserves ${safety} without retiring or fencing`, async () => {
	const f = fixture(); await f.owner.mount(); f.state.safety = safety;
	f.close(); f.close(); await settle();
	assert.deepEqual(f.responses, [{ requestId: 'request-1', allow: false }]); assert.deepEqual(f.vetoes, [safety]);
	assert.equal(f.state.fences, 0); assert.equal(f.state.retirements, 0); assert.equal(f.owner.isClosing(), false);
	f.state.safety = 'ready'; f.close('request-2'); await settle();
	assert.deepEqual(f.responses.at(-1), { requestId: 'request-2', allow: true }); await f.owner.dispose();
});

test('close fences synchronously and acknowledges only after the actual retirement joins', async () => {
	const release = deferred<void>(); let calls = 0;
	const f = fixture({ retireAndJoin: () => { calls++; return release.promise; } }); await f.owner.mount();
	f.close(); assert.equal(f.owner.isClosing(), true); assert.equal(f.state.fences, 1); assert.equal(calls, 1);
	f.close(); f.close('request-2'); await settle(); assert.deepEqual(f.responses, []);
	release.resolve(); await settle(); assert.equal(calls, 1);
	assert.deepEqual(f.responses, [{ requestId: 'request-1', allow: true }, { requestId: 'request-2', allow: true }]);
	assert.ok(f.responses.every(Object.isFrozen)); await f.owner.dispose();
});

test('reentrant disposal during the synchronous fence still joins the later retirement and prevents stale ACK', async () => {
	const release = deferred<void>(); let disposal: Promise<void> | undefined, finished = false;
	const f = fixture({ fence: () => { disposal = owner.dispose(); void disposal.then(() => { finished = true; }); }, retireAndJoin: () => release.promise });
	const owner = f.owner; await owner.mount(); f.close(); await settle();
	assert.ok(disposal); assert.equal(owner.dispose(), disposal); assert.equal(finished, false); assert.deepEqual(f.responses, []);
	release.resolve(); await disposal; assert.equal(finished, true); assert.equal(f.state.cleanups, 1); assert.deepEqual(f.responses, []);
});

test('a reentrant close during fencing shares the already registered retirement', async () => {
	const release = deferred<void>(); let calls = 0;
	const f = fixture({ fence: () => { invoke(); }, retireAndJoin: () => { calls++; return release.promise; } });
	await f.owner.mount(); const invoke = () => { f.close('reentrant'); }; f.close(); await settle();
	assert.equal(calls, 1); assert.deepEqual(f.responses, []); release.resolve(); await settle();
	assert.deepEqual(f.responses, [{ requestId: 'reentrant', allow: true }, { requestId: 'request-1', allow: true }]);
	await f.owner.dispose();
});

test('an opaque retirement failure keeps the renderer fenced, vetoes retry and preserves cleanup failure identity', async () => {
	const failure = Object.freeze({ opaque: 'retirement' }); let calls = 0;
	const f = fixture({ retireAndJoin: () => { calls++; return Promise.reject(failure); } }); await f.owner.mount();
	f.close(); await settle(); f.close('request-2'); await settle();
	assert.equal(calls, 1); assert.equal(f.owner.isClosing(), true);
	assert.deepEqual(f.responses, [{ requestId: 'request-1', allow: false }, { requestId: 'request-2', allow: false }]);
	assert.ok(f.errors.every(error => Object.is(error, failure)));
	const result = await f.owner.dispose().then(() => ({ ok: true }), (error: unknown) => ({ ok: false, error }));
	assert.equal(result.ok, false); assert.ok('error' in result && Object.is(result.error, failure));
});

test('ready and bridge delivery failures are observed without authorizing a close or replaying it', async () => {
	const failure = Object.freeze({ opaque: 'bridge' }); let listener: ((request: unknown) => void) | undefined, deliveries = 0;
	const f = fixture({ bridge: { signalReady: () => Promise.reject(failure),
		onCloseRequested(callback) { listener = callback; return () => undefined; },
		respondToClose() { deliveries++; return Promise.reject(failure); } } });
	await f.owner.mount(); assert.equal(f.errors[0], failure); assert.ok(listener);
	listener({ requestId: 'request', reason: 'quit' }); await settle(); listener({ requestId: 'request', reason: 'quit' }); await settle();
	assert.equal(deliveries, 1); assert.equal(f.errors[1], failure); await f.owner.dispose();
});

test('malformed native requests do not invoke accessors or create close authority', async () => {
	let reads = 0; const f = fixture(); await f.owner.mount();
	const getter = Object.defineProperty({ reason: 'quit' }, 'requestId', { enumerable: true, get() { reads++; return 'forged'; } });
	for (const request of [null, [], getter, { requestId: 'request', reason: 'reload' }, { requestId: 'request', reason: 'quit', extra: true },
		{ requestId: '../path', reason: 'quit' }, { requestId: 'request' }]) f.request(request);
	await settle(); assert.equal(reads, 0); assert.equal(f.state.fences, 0); assert.deepEqual(f.responses, []); await f.owner.dispose();
});

test('subscription-time reentrant disposal releases the subscription returned afterward', async () => {
	let cleanups = 0;
	const f = fixture({ bridge: { signalReady() { throw Error('Detached readiness'); },
		onCloseRequested() { void owner.dispose(); return () => { cleanups++; }; }, respondToClose() { throw Error('Detached ACK'); } } });
	const owner = f.owner; await owner.mount(); await owner.dispose(); assert.equal(cleanups, 1); assert.deepEqual(f.errors, []);
});

test('cleanup reentrancy returns one disposal promise and retains even an undefined thrown value', async () => {
	let reentrant: Promise<void> | undefined;
	const f = fixture({ bridge: { signalReady() {}, onCloseRequested() { return () => { reentrant = owner.dispose(); throw undefined; }; }, respondToClose() {} } });
	const owner = f.owner; await owner.mount(); const disposal = owner.dispose(); assert.equal(disposal, reentrant);
	const result = await disposal.then(() => ({ ok: true }), (error: unknown) => ({ ok: false, error }));
	assert.equal(result.ok, false); assert.ok('error' in result && Object.is(result.error, undefined));
});
