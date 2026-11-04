/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import { verifyMirroredArtifact, verifyMirroredArtifactDelivery } from '../scripts/lib/local-model-mirror-publication.mjs';

const bytes = Buffer.from('authenticated runtime archive');
const artifact = { byteLength: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
const url = 'https://assets.soundscaper.org/runtime/assistance/test/archive.tar.gz';

interface DeliveryOptions {
	readonly rangeStatus?: number;
	readonly rangeHeaders?: Readonly<Record<string, string>>;
	readonly fullBody?: Uint8Array<ArrayBuffer>;
	readonly omitRangeLength?: boolean;
}

function delivery({ rangeStatus = 200, rangeHeaders = {}, fullBody = bytes, omitRangeLength = false }: DeliveryOptions = {}) {
	const requests: string[] = [];
	let cancelled = 0;
	const fetchImpl: typeof fetch = async (_address, init) => {
		const ranged = new Headers(init?.headers).has('Range');
		requests.push(init?.method === 'HEAD' ? 'HEAD' : ranged ? 'range' : 'body');
		const headers = {
			'Access-Control-Allow-Origin': 'https://soundscaper.org',
			'Content-Length': String(bytes.length),
		};
		if (ranged) {
			const responseHeaders = new Headers({ ...headers, ...rangeHeaders });
			if (omitRangeLength) responseHeaders.delete('Content-Length');
			return new Response(new ReadableStream<Uint8Array>({ cancel() { cancelled += 1; } }), {
				status: rangeStatus, headers: responseHeaders,
			});
		}
		return new Response(init?.method === 'HEAD' ? null : fullBody, { headers });
	};
	return { fetchImpl, requests, cancelled: () => cancelled };
}

for (const verify of [verifyMirroredArtifact, verifyMirroredArtifactDelivery]) {
	test(`${verify.name} accepts an ignored optional range without reading or retrying its full body`, async () => {
		for (const omitRangeLength of [false, true]) {
			const source = delivery({ omitRangeLength });
			assert.deepEqual(await verify({ url, artifact, fetchImpl: source.fetchImpl,
				signal: undefined, requireRange: false }), { url, ...artifact });
			assert.equal(source.cancelled(), 1);
			assert.deepEqual(source.requests, verify === verifyMirroredArtifact
				? ['HEAD', 'body', 'range'] : ['HEAD', 'range']);
		}
	});

	test(`${verify.name} still rejects incorrect delivery metadata with optional ranges`, async () => {
		for (const [rangeHeaders, expected] of [
			[{ 'Access-Control-Allow-Origin': 'https://other.example' }, /CORS/u],
			[{ 'Content-Length': '1' }, /Content-Length/u],
		] as const) {
			const source = delivery({ rangeHeaders });
			await assert.rejects(verify({ url, artifact, fetchImpl: source.fetchImpl,
				signal: undefined, requireRange: false }), expected);
			assert.equal(source.cancelled(), 1);
		}
	});

	test(`${verify.name} still requires an exact partial response when ranges are optional`, async () => {
		const source = delivery({ rangeStatus: 206, rangeHeaders: {
			'Content-Range': `bytes 1-1/${bytes.length}`, 'Content-Length': '1',
		} });
		await assert.rejects(verify({ url, artifact, fetchImpl: source.fetchImpl,
			signal: undefined, requireRange: false }), /Content-Range/u);
	});

	test(`${verify.name} still rejects permanent HTTP failures when ranges are optional`, async () => {
		const source = delivery({ rangeStatus: 404 });
		await assert.rejects(verify({ url, artifact, fetchImpl: source.fetchImpl,
			signal: undefined, requireRange: false }), /HTTP 404/u);
		assert.equal(source.cancelled(), 1);
	});
}

test('optional ranges never bypass complete runtime archive authentication', async () => {
	for (const fullBody of [Buffer.from('short'), Buffer.alloc(bytes.length)]) {
		const source = delivery({ fullBody });
		await assert.rejects(verifyMirroredArtifact({ url, artifact, fetchImpl: source.fetchImpl,
			signal: undefined, requireRange: false }), /served.*not the recorded/u);
		assert.deepEqual(source.requests, ['HEAD', 'body']);
	}
});

test('cancellation while discarding an ignored optional range remains terminal', async () => {
	const controller = new AbortController();
	const reason = new Error('cancelled verification');
	const source = delivery();
	const fetchImpl: typeof fetch = async (address, init) => {
		if (!new Headers(init?.headers).has('Range')) return source.fetchImpl(address, init);
		return new Response(new ReadableStream<Uint8Array>({ cancel() { controller.abort(reason); } }), {
			headers: { 'Access-Control-Allow-Origin': 'https://soundscaper.org', 'Content-Length': String(bytes.length) },
		});
	};
	await assert.rejects(verifyMirroredArtifactDelivery({ url, artifact, fetchImpl,
		signal: controller.signal, requireRange: false }), error => error === reason);
});
