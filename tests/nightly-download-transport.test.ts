/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import { verifiedNightlyPythonArchive } from '../scripts/provision-nightly-interchange.mjs';

const url = 'https://github.com/astral-sh/python-build-standalone/releases/download/pin/python.tar.gz';
const metadataUrl = 'https://api.github.com/repos/astral-sh/python-build-standalone/releases/tags/pin';
const assetUrl = 'https://api.github.com/repos/astral-sh/python-build-standalone/releases/assets/123';
const bytes = 'pinned reference Python';
const pin = { url, sha256: createHash('sha256').update(bytes).digest('hex') };

test('nightly Python recovers a persistent public release failure through the exact asset API', async () => {
	const requests: string[] = [];
	const fetchImpl: typeof fetch = async input => {
		const address = String(input);
		requests.push(address);
		if (address === url) return new Response(null, { status: 504 });
		if (address === metadataUrl) return Response.json({ tag_name: 'pin', assets: [{
			id: 123, name: 'python.tar.gz', browser_download_url: url,
		}] });
		assert.equal(address, assetUrl);
		return new Response(bytes);
	};
	assert.equal((await verifiedNightlyPythonArchive(pin, fetchImpl)).toString(), bytes);
	assert.deepEqual(requests, [url, metadataUrl, assetUrl]);
});

test('nightly Python retries an interrupted body and authenticates only the completed archive', async () => {
	let requests = 0;
	const fetchImpl: typeof fetch = async () => {
		requests += 1;
		if (requests > 1) return new Response(bytes);
		return new Response(new ReadableStream({ start(controller) {
			controller.error(Object.assign(new Error('HTTP/2 stream refused'), { code: 'ERR_HTTP2_STREAM_ERROR' }));
		} }));
	};
	assert.equal((await verifiedNightlyPythonArchive(pin, fetchImpl)).toString(), bytes);
	assert.equal(requests, 2);
});

test('nightly Python refuses incorrect bytes from the API without repeating an integrity failure', async () => {
	let downloads = 0;
	await assert.rejects(verifiedNightlyPythonArchive(pin, async input => {
		if (String(input) === url) return new Response(null, { status: 504 });
		if (String(input) === metadataUrl) return Response.json({ tag_name: 'pin', assets: [{
			id: 123, name: 'python.tar.gz', browser_download_url: url,
		}] });
		downloads += 1;
		return new Response('changed Python');
	}), /digest/u);
	assert.equal(downloads, 1);
});
