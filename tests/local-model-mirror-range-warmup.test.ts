/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import { verifyMirroredArtifact, verifyMirroredArtifactDelivery } from '../scripts/lib/local-model-mirror-publication.mjs';

const bytes = Buffer.from('authenticated archive');
const artifact = { byteLength: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
const url = 'https://assets.soundscaper.org/runtime/assistance/test/archive.tar.gz';

function publicResponse(init: RequestInit = {}): Response {
	const ranged = new Headers(init.headers).has('Range');
	return new Response(init.method === 'HEAD' ? null : ranged ? bytes.subarray(0, 1) : bytes, {
		status: ranged ? 206 : 200,
		headers: {
			'Access-Control-Allow-Origin': 'https://soundscaper.org',
			'Access-Control-Expose-Headers': 'Content-Range',
			'Content-Length': String(ranged ? 1 : bytes.length),
			...(ranged ? { 'Content-Range': `bytes 0-0/${bytes.length}` } : {}),
		},
	});
}

test('range verification lets cold CDN metadata settle before its one retry', async () => {
	const rangeTimes: number[] = [];
	let cancelled = 0;
	let fullReads = 0;
	const fetchImpl: typeof fetch = async (_address, init) => {
		if (new Headers(init?.headers).has('Range')) {
			rangeTimes.push(Date.now());
			if (rangeTimes.length === 1 || Date.now() - rangeTimes[0] < 100) {
				return new Response(new ReadableStream({ cancel() { cancelled += 1; } }), { status: 200 });
			}
		} else if (init?.method === 'GET') fullReads += 1;
		return publicResponse(init);
	};
	assert.deepEqual(await verifyMirroredArtifactDelivery({ url, artifact, fetchImpl, signal: undefined }), { url, ...artifact });
	assert.equal(cancelled, 1, 'The ignored full response must be cancelled without reading its body.');
	assert.equal(rangeTimes.length, 2, 'The cold-edge retry remains bounded.');
	assert.ok(rangeTimes[1] - rangeTimes[0] >= 100);
	assert.equal(fullReads, 0, 'Delivery-only probes must not download a complete archive.');
});

test('cancelling the cold-edge pause prevents another range request or full download', async () => {
	const controller = new AbortController();
	const reason = new Error('cancelled verification');
	let ranges = 0;
	let fullReads = 0;
	const fetchImpl: typeof fetch = async (_address, init) => {
		if (new Headers(init?.headers).has('Range') && ranges++ === 0) {
			return new Response(new ReadableStream({ cancel() {
				setImmediate(() => { controller.abort(reason); });
			} }), { status: 200 });
		}
		if (init?.method === 'GET' && !new Headers(init.headers).has('Range')) fullReads += 1;
		return publicResponse(init);
	};
	await assert.rejects(verifyMirroredArtifactDelivery({ url, artifact, fetchImpl, signal: controller.signal }),
		error => error === reason || (error instanceof Error && error.name === 'AbortError' && error.cause === reason));
	assert.equal(ranges, 1);
	assert.equal(fullReads, 0);
});

test('complete archive verification finishes the authenticated body before probing an uncached CDN range', async () => {
	let complete = false;
	let reads = 0;
	const requests: string[] = [];
	const fetchImpl: typeof fetch = async (_address, init) => {
		const ranged = new Headers(init?.headers).has('Range');
		requests.push(init?.method === 'HEAD' ? 'HEAD' : ranged ? 'range' : 'body');
		if (ranged && !complete) return new Response(null, { status: 200 });
		if (init?.method === 'GET' && !ranged) {
			return new Response(new ReadableStream({ pull(controller) {
				if (reads++ === 0) controller.enqueue(bytes);
				else { complete = true; controller.close(); }
			} }), { headers: publicResponse(init).headers });
		}
		return publicResponse(init);
	};
	assert.deepEqual(await verifyMirroredArtifact({ url, artifact, fetchImpl, signal: undefined }), { url, ...artifact });
	assert.equal(complete, true);
	assert.deepEqual(requests, ['HEAD', 'body', 'range']);
});
