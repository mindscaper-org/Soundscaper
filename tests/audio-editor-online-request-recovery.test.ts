/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createRecoveringOnlineFetch, OnlineMutationOutcomeUnknownError } from '../src/common/editor/online-request-recovery.ts';

test('safe online reads retry interrupted bodies before returning their response', async () => {
	let calls = 0;
	const request = createRecoveringOnlineFetch(async () => {
		calls += 1;
		return calls === 1 ? new Response(new ReadableStream({ start(controller) { controller.enqueue(Uint8Array.of(1)); controller.error(new TypeError('socket closed')); } })) : new Response('{"data":1}');
	}, { retryDelayMs: 0, log: () => undefined });
	assert.equal(await (await request('https://example.test')).text(), '{"data":1}');
	assert.equal(calls, 2);
});

test('mutations wait for connectivity before sending and never replay ambiguous failures', async () => {
	let online = false, calls = 0, waits = 0;
	const request = createRecoveringOnlineFetch(async () => { calls += 1; throw new TypeError('connection lost'); }, {
		isOnline: () => online, wait: async () => { waits += 1; online = true; }, log: () => undefined,
	});
	await assert.rejects(request('https://example.test', { method: 'POST', body: 'audio' }), /server may have received/iu);
	assert.equal(calls, 1); assert.equal(waits, 1);
});

test('stalled requests settle even if fetch ignores cancellation and late responses are retired', async () => {
	let finish!: (response: Response) => void, cancelled = false;
	const request = createRecoveringOnlineFetch(() => new Promise(resolve => { finish = resolve; }), { requestTimeoutMs: 5, maximumAttempts: 1 });
	await assert.rejects(request('https://example.test'), { name: 'TimeoutError' });
	finish(new Response(new ReadableStream({ cancel() { cancelled = true; } })));
	await new Promise(resolve => setImmediate(resolve)); assert.equal(cancelled, true);
});

test('a stalled response body times out, cancels transport and leaves mutations unreplayed', async () => {
	let calls = 0, cancelled = false;
	const request = createRecoveringOnlineFetch(async () => {
		calls += 1; return new Response(new ReadableStream({ cancel() { cancelled = true; } }));
	}, { idleTimeoutMs: 5, requestTimeoutMs: 50 });
	await assert.rejects(request('https://example.test', { method: 'POST' }), /server may have received/iu);
	assert.equal(calls, 1); assert.equal(cancelled, true);
});

test('caller abort immediately releases offline waits and preserves its reason', async () => {
	const controller = new AbortController(), reason = new Error('closed');
	const request = createRecoveringOnlineFetch(async () => { throw new Error('must not send'); }, { isOnline: () => false });
	const pending = request('https://example.test', { signal: controller.signal }); controller.abort(reason);
	await assert.rejects(pending, error => error === reason);
});

test('offline recovery has a bounded window', async () => {
	const request = createRecoveringOnlineFetch(async () => { throw new Error('must not send'); }, {
		isOnline: () => false, offlineWaitMs: 2, log: () => undefined,
		wait: async milliseconds => { assert.ok(milliseconds <= 2); await new Promise(resolve => setTimeout(resolve, milliseconds)); },
	});
	await assert.rejects(request('https://example.test'), { name: 'TimeoutError' });
});

test('authentication and validation responses are returned without retries', async () => {
	let calls = 0;
	const request = createRecoveringOnlineFetch(async () => { calls += 1; return new Response('denied', { status: 401 }); });
	assert.equal((await request('https://example.test')).status, 401); assert.equal(calls, 1);
});

test('safe HTTP retries honor a bounded Retry-After and retain the final status', async () => {
	let calls = 0; const delays: number[] = [];
	const request = createRecoveringOnlineFetch(async () => { calls += 1; return new Response('busy', { status: 503, headers: { 'Retry-After': '90' } }); }, {
		wait: async milliseconds => { delays.push(milliseconds); }, log: () => undefined,
	});
	assert.equal((await request('https://example.test')).status, 503);
	assert.equal(calls, 3); assert.deepEqual(delays, [30_000, 30_000]);
});

test('temporary server errors recover on reads without replaying a mutation', async () => {
	let calls = 0;
	const request = createRecoveringOnlineFetch(async () => {
		calls += 1;
		return new Response(calls === 1 ? 'temporary failure' : 'recovered', { status: calls === 1 ? 500 : 200 });
	}, { retryDelayMs: 0, log: () => undefined });
	assert.equal(await (await request('https://example.test')).text(), 'recovered');
	assert.equal(calls, 2);
	calls = 0;
	await assert.rejects(request('https://example.test', { method: 'POST' }), error => error instanceof OnlineMutationOutcomeUnknownError && error.status === 500);
	assert.equal(calls, 1);
});

test('whole-read recovery excludes consumer validation TypeErrors', async () => {
	const { recoverOnlineRead } = await import('../src/common/editor/online-request-recovery.ts');
	let calls = 0;
	await assert.rejects(recoverOnlineRead(async () => { calls += 1; throw new TypeError('Invalid audio MIME'); }), /Invalid audio MIME/u);
	assert.equal(calls, 1);
});

test('an incomplete declared response retries without exposing its truncated body', async () => {
	let calls = 0;
	const request = createRecoveringOnlineFetch(async () => {
		calls += 1; return new Response(calls === 1 ? 'a' : 'abcd', { headers: { 'Content-Length': '4' } });
	}, { retryDelayMs: 0, log: () => undefined });
	assert.equal(await (await request('https://example.test')).text(), 'abcd'); assert.equal(calls, 2);
});

test('download response errors retry only transient HTTP status codes', async () => {
	const { onlineReadResponseError, recoverOnlineRead } = await import('../src/common/editor/online-request-recovery.ts');
	let calls = 0;
	assert.equal(await recoverOnlineRead(async () => {
		calls += 1;
		if (calls === 1) throw onlineReadResponseError(new Response(null, { status: 503 }), new Error('Unavailable (503)'));
		return 'recovered';
	}, undefined, { retryDelayMs: 0, log: () => undefined }), 'recovered');
	assert.equal(calls, 2);
	const denied = new Error('Authentication expired');
	assert.equal(onlineReadResponseError(new Response(null, { status: 401 }), denied), denied);
});
