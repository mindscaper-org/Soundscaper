/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import { verifyMirroredArtifact } from '../scripts/lib/local-model-mirror-publication.mjs';

const PAYLOAD = Buffer.from('verified model bytes');
const URL = 'https://assets.soundscaper.org/models/example/1.0.0/model.onnx';
const ARTIFACT = Object.freeze({
	byteLength: PAYLOAD.length,
	sha256: createHash('sha256').update(PAYLOAD).digest('hex'),
});
const CORS = { 'Access-Control-Allow-Origin': 'https://soundscaper.org' };

function publicResponse(options) {
	if (options.method === 'HEAD') return new Response(null, {
		status: 200,
		headers: { ...CORS, 'Content-Length': String(PAYLOAD.length) },
	});
	if (options.headers.Range === 'bytes=0-0') return new Response(PAYLOAD.subarray(0, 1), {
		status: 206,
		headers: {
			...CORS,
			'Content-Length': '1',
			'Content-Range': `bytes 0-0/${PAYLOAD.length}`,
			'Access-Control-Expose-Headers': 'Content-Range',
		},
	});
	return new Response(PAYLOAD, { status: 200, headers: CORS });
}

test('public mirror verification retries a transient connection timeout', async () => {
	const requests = [];
	let attempts = 0;
	const result = await verifyMirroredArtifact({
		url: URL,
		artifact: ARTIFACT,
		fetchImpl: async (_url, options) => {
			attempts += 1;
			if (attempts === 1) {
				throw new TypeError('fetch failed', {
					cause: Object.assign(new Error('Connect Timeout Error'), {
						code: 'UND_ERR_CONNECT_TIMEOUT',
					}),
				});
			}
			requests.push(options.method);
			return publicResponse(options);
		},
	});
	assert.deepEqual(result, { url: URL, byteLength: ARTIFACT.byteLength, sha256: ARTIFACT.sha256 });
	assert.equal(attempts, 4);
	assert.deepEqual(requests, ['HEAD', 'GET', 'GET']);
});

function interruptedBody() {
	let reads = 0;
	return new ReadableStream({
		pull(controller) {
			if (reads++ === 0) controller.enqueue(PAYLOAD.subarray(0, 7));
			else controller.error(new TypeError('terminated', {
				cause: Object.assign(new Error('HTTP/2 stream closed'), { code: 'ERR_HTTP2_STREAM_ERROR' }),
			}));
		},
	});
}

for (const phase of ['HEAD', 'range', 'body']) {
	test(`public mirror verification retries HTTP 502 during ${phase}`, async () => {
		let attempts = 0, cancelled = 0;
		const result = await verifyMirroredArtifact({ url: URL, artifact: ARTIFACT,
			fetchImpl: async (_url, options) => {
				const actual = options.method === 'HEAD' ? 'HEAD' : options.headers.Range ? 'range' : 'body';
				if (actual === phase && attempts++ === 0) {
					return new Response(options.method === 'HEAD' ? null : new ReadableStream({
						cancel() { cancelled += 1; },
					}), { status: 502 });
				}
				return publicResponse(options);
			},
		});
		assert.deepEqual(result, { url: URL, ...ARTIFACT });
		assert.equal(attempts, 2);
		assert.equal(cancelled, phase === 'HEAD' ? 0 : 1);
	});
}

test('public mirror verification restarts hashing after a mid-body HTTP/2 disconnect', async () => {
	let attempts = 0;
	const result = await verifyMirroredArtifact({ url: URL, artifact: ARTIFACT,
		fetchImpl: async (_url, options) => {
			if (options.method === 'GET' && !options.headers.Range && attempts++ === 0) {
				return new Response(interruptedBody(), { headers: CORS });
			}
			return publicResponse(options);
		},
	});
	assert.deepEqual(result, { url: URL, ...ARTIFACT });
	assert.equal(attempts, 2);
});

test('public mirror verification bounds repeated transient responses and body failures', async () => {
	for (const failure of ['http', 'body']) {
		let attempts = 0;
		await assert.rejects(verifyMirroredArtifact({ url: URL, artifact: ARTIFACT,
			fetchImpl: async (_url, options) => {
				if (options.method === 'GET' && !options.headers.Range) {
					attempts += 1;
					return failure === 'http' ? new Response(null, { status: 503 })
						: new Response(interruptedBody(), { headers: CORS });
				}
				return publicResponse(options);
			},
		}), failure === 'http' ? /HTTP 503/u : /terminated/u);
		assert.equal(attempts, 3);
	}
});

test('public mirror verification does not retry permanent or integrity failures', async () => {
	for (const failure of ['http', 'cors', 'digest', 'short']) {
		let attempts = 0;
		await assert.rejects(verifyMirroredArtifact({ url: URL, artifact: ARTIFACT,
			fetchImpl: async (_url, options) => {
				if (options.method === 'GET' && !options.headers.Range) {
					attempts += 1;
					if (failure === 'http') return new Response(null, { status: 403 });
					if (failure === 'cors') return new Response(PAYLOAD);
					return new Response(failure === 'digest' ? Buffer.alloc(PAYLOAD.length) : PAYLOAD.subarray(0, 7),
						{ headers: CORS });
				}
				return publicResponse(options);
			},
		}), /HTTP 403|CORS|not the recorded/u);
		assert.equal(attempts, 1);
	}
});

test('public mirror verification preserves aborts instead of retrying a broken stream', async () => {
	const abort = new AbortController(), reason = new Error('cancel public verification');
	let attempts = 0;
	await assert.rejects(verifyMirroredArtifact({ url: URL, artifact: ARTIFACT, signal: abort.signal,
		fetchImpl: async (_url, options) => {
			if (options.method === 'GET' && !options.headers.Range) {
				attempts += 1;
				return new Response(new ReadableStream({ pull(controller) {
					abort.abort(reason);
					controller.error(new TypeError('terminated', {
						cause: Object.assign(new Error('socket closed'), { code: 'UND_ERR_SOCKET' }),
					}));
				} }), { headers: CORS });
			}
			return publicResponse(options);
		},
	}), error => error === reason);
	assert.equal(attempts, 1);
});
