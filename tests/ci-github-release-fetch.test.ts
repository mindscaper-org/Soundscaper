/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { downloadCiBytes } from '../scripts/lib/ci-download-retry.mjs';
import { fetchGithubReleaseAsset } from '../scripts/lib/ci-github-release-fetch.mjs';

const url = 'https://github.com/fixture/tools/releases/download/tool%401.0/archive.tar.gz';
const metadataUrl = 'https://api.github.com/repos/fixture/tools/releases/tags/tool%401.0';
const assetUrl = 'https://api.github.com/repos/fixture/tools/releases/assets/123';
const asset = { id: 123, name: 'archive.tar.gz', browser_download_url: url };

test('a persistent release URL failure downloads the exact named asset through the official API', async () => {
	const requests: { url: string; accept: string | null; authorization: string | null; signal?: AbortSignal | null }[] = [];
	const signal = new AbortController().signal;
	const fetchImpl: typeof fetch = async (input, init) => {
		const address = String(input);
		const headers = new Headers(init?.headers);
		requests.push({ url: address, accept: headers.get('Accept'), authorization: headers.get('Authorization'), signal: init?.signal });
		if (address === url) return new Response(null, { status: 504 });
		if (address === metadataUrl) return Response.json({ tag_name: 'tool@1.0', assets: [asset] });
		assert.equal(address, assetUrl);
		return new Response('pinned bytes');
	};
	const response = await fetchGithubReleaseAsset(url, { signal }, { fetchImpl, token: 'fixture-token' });
	assert.equal(await response.text(), 'pinned bytes');
	assert.deepEqual(requests.map(request => request.url), [url, metadataUrl, assetUrl]);
	assert.equal(requests[0]?.authorization, null);
	assert.equal(requests[1]?.authorization, 'Bearer fixture-token');
	assert.equal(requests[2]?.accept, 'application/octet-stream');
	assert.ok(requests.every(request => request.signal === signal));
});

test('ordinary downloads and permanent release errors keep their original response', async () => {
	for (const [address, status] of [[url, 200], [url, 404], ['https://fixture.invalid/archive', 504]] as const) {
		let requests = 0;
		const response = new Response(null, { status });
		assert.equal(await fetchGithubReleaseAsset(address, {}, { fetchImpl: async () => { requests += 1; return response; } }), response);
		assert.equal(requests, 1);
	}
});

test('an interrupted HTTP/2 request can use the release API, while cancellation cannot', async () => {
	let requests = 0;
	const fetchImpl: typeof fetch = async input => {
		requests += 1;
		if (String(input) === url) throw new TypeError('fetch failed', { cause: { code: 'ERR_HTTP2_STREAM_ERROR' } });
		if (String(input) === metadataUrl) return Response.json({ tag_name: 'tool@1.0', assets: [asset] });
		return new Response('archive');
	};
	assert.equal(await (await fetchGithubReleaseAsset(url, {}, { fetchImpl })).text(), 'archive');
	assert.equal(requests, 3);
	const reason = new Error('cancelled');
	await assert.rejects(fetchGithubReleaseAsset(url, { signal: AbortSignal.abort(reason) }, { fetchImpl: async () => { throw reason; } }), error => error === reason);
});

test('fallback metadata cannot select a different release, name, URL, or duplicate asset', async () => {
	for (const metadata of [
		{ tag_name: 'different', assets: [asset] },
		{ tag_name: 'tool@1.0', assets: [{ ...asset, name: 'different.tar.gz' }] },
		{ tag_name: 'tool@1.0', assets: [{ ...asset, browser_download_url: url.replace('fixture/tools', 'other/tools') }] },
		{ tag_name: 'tool@1.0', assets: [asset, asset] },
	]) {
		await assert.rejects(fetchGithubReleaseAsset(url, {}, { fetchImpl: async input => {
			if (String(input) === url) return new Response(null, { status: 504 });
			assert.equal(String(input), metadataUrl);
			return Response.json(metadata);
		} }), /exact release asset/u);
	}
});

test('bootstrap downloads retain their byte ceiling after release-API fallback', async () => {
	await assert.rejects(downloadCiBytes(url, { maximumBytes: 4, fetchImpl: async input => {
		if (String(input) === url) return new Response(null, { status: 504 });
		if (String(input) === metadataUrl) return Response.json({ tag_name: 'tool@1.0', assets: [asset] });
		assert.equal(String(input), assetUrl);
		return new Response('oversized');
	} }), /pinned 4 bytes/u);
});

test('release metadata is bounded before JSON parsing', async () => {
	await assert.rejects(fetchGithubReleaseAsset(url, {}, { fetchImpl: async input =>
		String(input) === url ? new Response(null, { status: 504 }) : new Response('x'.repeat(2 * 1024 * 1024 + 1)),
	}), /metadata.*limit/u);
});
