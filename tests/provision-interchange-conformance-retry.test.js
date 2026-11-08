/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { fetchWithTransientRetry } from '../scripts/provision-interchange-conformance.mjs';

test('interchange reference provisioning retries a temporary connection timeout', async () => {
	let attempts = 0;
	const delays = [];
	const response = new Response('pinned wheel');
	const result = await fetchWithTransientRetry('https://files.pythonhosted.org/wheel', {
		fetchImpl: async () => {
			attempts += 1;
			if (attempts < 3) throw new TypeError('fetch failed', {
				cause: Object.assign(new Error('Connect Timeout Error'), {
					code: 'UND_ERR_CONNECT_TIMEOUT',
				}),
			});
			return response;
		},
		delayImpl: async (milliseconds) => { delays.push(milliseconds); },
	});
	assert.equal(result, response);
	assert.equal(attempts, 3);
	assert.deepEqual(delays, [250, 500]);
});

test('interchange reference provisioning does not retry a permanent fetch error', async () => {
	let attempts = 0;
	await assert.rejects(fetchWithTransientRetry('https://pypi.org/pypi/example/1/json', {
		fetchImpl: async () => {
			attempts += 1;
			throw new TypeError('invalid URL');
		},
		delayImpl: async () => { throw new Error('unexpected retry'); },
	}), /invalid URL/u);
	assert.equal(attempts, 1);
});

test('interchange reference provisioning stops after three transient failures', async () => {
	let attempts = 0;
	await assert.rejects(fetchWithTransientRetry('https://pypi.org/pypi/example/1/json', {
		fetchImpl: async () => {
			attempts += 1;
			throw new TypeError('fetch failed', {
				cause: Object.assign(new Error('connection reset'), { code: 'ECONNRESET' }),
			});
		},
		delayImpl: async () => {},
	}), /fetch failed/u);
	assert.equal(attempts, 3);
});

test('interchange provisioning retries the HTTP/2 stream failure seen on hosted Windows', async () => {
	let attempts = 0;
	const result = await fetchWithTransientRetry('https://files.pythonhosted.org/wheel', {
		fetchImpl: async () => {
			attempts += 1;
			if (attempts === 1) throw new TypeError('fetch failed', { cause: { code: 'ERR_HTTP2_STREAM_ERROR' } });
			return new Response('wheel');
		},
		delayImpl: async () => {},
	});
	assert.equal(await result.text(), 'wheel');
	assert.equal(attempts, 2);
});

test('interchange provisioning discards transient HTTP error bodies before retrying', async () => {
	let attempts = 0;
	let cancelled = false;
	const result = await fetchWithTransientRetry('https://pypi.org/pypi/example/1/json', {
		fetchImpl: async () => {
			attempts += 1;
			return attempts === 1
				? new Response(new ReadableStream({ cancel() { cancelled = true; } }), { status: 503 })
				: Response.json({ name: 'example' });
		},
		delayImpl: async () => {},
	});
	assert.equal(result.status, 200);
	assert.deepEqual(await result.json(), { name: 'example' });
	assert.equal(attempts, 2);
	assert.equal(cancelled, true);
});
