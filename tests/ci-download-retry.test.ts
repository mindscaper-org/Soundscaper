/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { downloadCiBytes } from '../scripts/lib/ci-download-retry.mjs';

test('CI downloads discard transient responses and retry the complete bounded body', async () => {
	let requests = 0;
	let cancelled = false;
	const waits: number[] = [];
	const bytes = await downloadCiBytes('https://fixture.invalid/archive', {
		maximumBytes: 4,
		fetchImpl: async () => {
			requests += 1;
			if (requests === 1) return new Response(new ReadableStream({ cancel() { cancelled = true; } }), { status: 504 });
			if (requests === 2) throw new TypeError('fetch failed', { cause: { code: 'ECONNRESET' } });
			return new Response('test');
		},
		wait: async (milliseconds: number) => { waits.push(milliseconds); },
	});
	assert.equal(bytes.toString(), 'test');
	assert.equal(requests, 3);
	assert.equal(cancelled, true);
	assert.deepEqual(waits, [500, 1000]);
});

test('CI downloads stop after three transient failures', async () => {
	let requests = 0;
	await assert.rejects(downloadCiBytes('https://fixture.invalid/archive', {
		maximumBytes: 4,
		fetchImpl: async () => { requests += 1; return new Response(null, { status: 503 }); },
		wait: async () => undefined,
	}), /HTTP 503/u);
	assert.equal(requests, 3);
});

test('permanent responses and oversized bodies fail without retrying', async () => {
	for (const response of [new Response(null, { status: 404 }), new Response('oversized')]) {
		let requests = 0;
		await assert.rejects(downloadCiBytes('https://fixture.invalid/archive', {
			maximumBytes: 4,
			fetchImpl: async () => { requests += 1; return response; },
			wait: async () => { assert.fail('a permanent failure must not retry'); },
		}), /HTTP 404|pinned 4 bytes/u);
		assert.equal(requests, 1);
	}
});

test('a transient stream failure discards the incomplete archive', async () => {
	let requests = 0;
	const bytes = await downloadCiBytes('https://fixture.invalid/archive', {
		maximumBytes: 4,
		fetchImpl: async () => {
			requests += 1;
			if (requests > 1) return new Response('good');
			return new Response(new ReadableStream({ start(controller) {
				controller.enqueue(new Uint8Array([1]));
				controller.error(Object.assign(new Error('socket closed'), { code: 'UND_ERR_SOCKET' }));
			} }));
		},
		wait: async () => undefined,
	});
	assert.equal(bytes.toString(), 'good');
	assert.equal(requests, 2);
});
