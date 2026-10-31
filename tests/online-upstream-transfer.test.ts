/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { fetchUpstreamWithDeadline } from '../functions/api/_shared/upstream-transfer.ts';

test('upstream connection deadline settles an adapter that ignores abort', async () => {
	await assert.rejects(fetchUpstreamWithDeadline(() => new Promise(() => undefined), new URL('https://example.test'), {}, 5), { name: 'TimeoutError' });
});
test('upstream response idle deadline cancels a stalled authenticated transfer', async () => {
	let cancelled = false;
	const response = await fetchUpstreamWithDeadline(async () => new Response(new ReadableStream({ cancel() { cancelled = true; } })), new URL('https://example.test'), {}, 5);
	await assert.rejects(response.arrayBuffer(), { name: 'TimeoutError' }); assert.equal(cancelled, true);
});
test('upstream request idle deadline cancels a stalled upload without another mutation', async () => {
	let cancelled = false, calls = 0;
	const body = new ReadableStream<Uint8Array>({ cancel() { cancelled = true; } });
	await assert.rejects(fetchUpstreamWithDeadline(async (_input, init) => {
		calls += 1; await new Response(init?.body).arrayBuffer(); return new Response(null, { status: 204 });
	}, new URL('https://example.test'), { method: 'POST', body }, 5), { name: 'TimeoutError' });
	assert.equal(calls, 1); assert.equal(cancelled, true);
});
test('upstream cancellation preserves the caller reason and retires its response', async () => {
	const controller = new AbortController(), reason = new Error('client closed');
	let cancelled = false;
	const response = await fetchUpstreamWithDeadline(async () => new Response(new ReadableStream({ cancel() { cancelled = true; } })), new URL('https://example.test'), { signal: controller.signal }, 1000);
	controller.abort(reason); await assert.rejects(response.arrayBuffer(), error => error === reason); assert.equal(cancelled, true);
});

test('an early empty success retains the upload deadline until the request is drained', async () => {
	let cancelled!: (reason: unknown) => void;
	const cancellation = new Promise<unknown>(resolve => { cancelled = resolve; });
	const body = new ReadableStream<Uint8Array>({ cancel(reason) { cancelled(reason); } });
	const response = await fetchUpstreamWithDeadline(async () => new Response(null, { status: 204 }), new URL('https://example.test'), { method: 'PUT', body }, 5);
	assert.equal(response.status, 204);
	assert.equal((await cancellation as Error).name, 'TimeoutError');
});

test('discarding an early response retains the deadline of its unfinished upload', async () => {
	let cancelled!: (reason: unknown) => void;
	const cancellation = new Promise<unknown>(resolve => { cancelled = resolve; });
	const body = new ReadableStream<Uint8Array>({ cancel(reason) { cancelled(reason); } });
	const response = await fetchUpstreamWithDeadline(async () => new Response('accepted'), new URL('https://example.test'), { method: 'PUT', body }, 5);
	await response.body?.cancel();
	assert.equal((await cancellation as Error).name, 'TimeoutError');
});

test('an upstream refusal retires an unconsumed upload while retaining its error response', async () => {
	let cancelled = false;
	const body = new ReadableStream<Uint8Array>({ cancel() { cancelled = true; } });
	const response = await fetchUpstreamWithDeadline(async () => new Response('quota', { status: 413 }), new URL('https://example.test'), { method: 'PUT', body }, 1000);
	assert.equal(cancelled, true); assert.equal(await response.text(), 'quota');
});

test('rejected control response admission retires provider streams immediately', async () => {
	const audiocom = await import('../functions/api/audiocom/_shared/oauth-http.ts');
	const freesound = await import('../functions/api/freesound/_shared/oauth-http.ts');
	for (const read of [audiocom.readUpstreamJson, freesound.readUpstreamJson]) {
		for (const headers of [new Headers({ 'Content-Type': 'text/html' }), new Headers({ 'Content-Type': 'application/json', 'Content-Length': '100' })]) {
			let cancelled = false;
			const response = await fetchUpstreamWithDeadline(async () => new Response(new ReadableStream({ cancel() { cancelled = true; } }), { headers }), new URL('https://example.test'), {}, 1000);
			await assert.rejects(read(response, 10)); assert.equal(cancelled, true);
		}
	}
});
