/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { constants, createSecureServer } from 'node:http2';
import { resolve } from 'node:path';
import type { Socket } from 'node:net';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

import { configureCiArtifactFetch } from '../scripts/lib/ci-artifact-fetch.ts';

const execute = promisify(execFile);
const root = resolve(import.meta.dirname, '..');

test('local development retains its fetch implementation', () => {
	const scope = { fetch: globalThis.fetch };
	assert.equal(configureCiArtifactFetch(scope, {}), null);
	assert.equal(scope.fetch, globalThis.fetch);
});

test('CI fetch is installed once and preserves request options and explicit dispatchers', async () => {
	let observed: (RequestInit & { dispatcher?: unknown }) | undefined;
	const nativeFetch: typeof fetch = async (_input, init) => {
		observed = init;
		return new Response(null);
	};
	const scope = { fetch: nativeFetch };
	const dispatcher = configureCiArtifactFetch(scope, { CI: 'true' });
	assert.ok(dispatcher);
	try {
		const installed = scope.fetch;
		assert.notEqual(installed, nativeFetch);
		assert.equal(configureCiArtifactFetch(scope, { CI: 'true' }), dispatcher);
		assert.equal(scope.fetch, installed);
		const signal = new AbortController().signal;
		const headers = { Origin: 'https://soundscaper.org', Range: 'bytes=0-0' };
		await scope.fetch('https://assets.soundscaper.org/archive', { method: 'HEAD', headers, signal });
		assert.equal(observed?.dispatcher, dispatcher);
		assert.equal(observed?.method, 'HEAD');
		assert.equal(observed?.headers, headers);
		assert.equal(observed?.signal, signal);
		const custom = Symbol('caller dispatcher');
		const init = { method: 'GET', dispatcher: custom };
		await scope.fetch('https://assets.soundscaper.org/archive', init);
		assert.equal(observed?.dispatcher, custom);
	} finally {
		await dispatcher.close();
	}
});

test('CI mirror reads negotiate HTTP/1.1 when the TLS server offers a failing HTTP/2 stream', async context => {
	const certPath = resolve(root, 'tests/fixtures/web-vcr/fixture-cert.pem');
	const cert = await readFile(certPath);
	const key = await readFile(resolve(root, 'tests/fixtures/web-vcr/fixture-key.pem'));
	const bytes = Buffer.from('authenticated runtime bytes');
	const artifact = { byteLength: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
	const observations: { protocol: string; method?: string; range?: string }[] = [];
	const sockets = new Set<Socket>();
	const server = createSecureServer({ cert, key, allowHTTP1: true });
	server.on('connection', socket => {
		sockets.add(socket);
		socket.on('close', () => { sockets.delete(socket); });
	});
	server.on('stream', stream => { stream.on('error', () => undefined); });
	server.on('request', (request, response) => {
		observations.push({ protocol: request.httpVersion, method: request.method, range: request.headers.range });
		if (request.httpVersionMajor === 2 && 'stream' in response) {
			response.stream.close(constants.NGHTTP2_INTERNAL_ERROR);
			return;
		}
		const ranged = request.headers.range === 'bytes=0-0';
		response.writeHead(ranged ? 206 : 200, {
			'Access-Control-Allow-Origin': 'https://soundscaper.org',
			'Access-Control-Expose-Headers': 'Content-Range',
			'Content-Length': ranged ? 1 : bytes.length,
			...(ranged ? { 'Content-Range': `bytes 0-0/${bytes.length}` } : {}),
		});
		if (request.method === 'HEAD') response.end();
		else response.end(ranged ? bytes.subarray(0, 1) : bytes);
	});
	context.after(async () => {
		for (const socket of sockets) socket.destroy();
		await new Promise<void>((resolveClose, reject) => {
			server.close(error => error ? reject(error) : resolveClose());
		});
	});
	await new Promise<void>(resolveListen => server.listen(0, '127.0.0.1', resolveListen));
	const address = server.address();
	assert.ok(address && typeof address !== 'string');
	const url = `https://127.0.0.1:${address.port}/archive`;
	const moduleUrl = pathToFileURL(resolve(root, 'scripts/lib/ci-artifact-fetch.ts')).href;
	const verifierUrl = pathToFileURL(resolve(root, 'scripts/lib/local-model-mirror-publication.mjs')).href;
	const child = await execute(process.execPath, ['--input-type=module', '-e', `
		import assert from 'node:assert/strict';
		import { Agent } from 'undici';
		import { configureCiArtifactFetch } from ${JSON.stringify(moduleUrl)};
		import { verifyMirroredArtifact } from ${JSON.stringify(verifierUrl)};
		const http2 = new Agent({ allowH2: true });
		try {
			await assert.rejects(async () => {
				const response = await fetch(${JSON.stringify(url)}, { dispatcher: http2 });
				await response.arrayBuffer();
			});
		} finally { await http2.close(); }
		const dispatcher = configureCiArtifactFetch();
		assert.ok(dispatcher);
		try {
			const result = await verifyMirroredArtifact({ url: ${JSON.stringify(url)}, artifact: ${JSON.stringify(artifact)} });
			const reason = new Error('cancelled request');
			await assert.rejects(fetch(${JSON.stringify(url)}, { signal: AbortSignal.abort(reason) }), error => error === reason);
			console.log(JSON.stringify(result));
		} finally { await dispatcher.close(); }
	`], { cwd: root, timeout: 20_000, env: { ...process.env, CI: 'true',
		NODE_EXTRA_CA_CERTS: certPath, NO_PROXY: '127.0.0.1,localhost', no_proxy: '127.0.0.1,localhost' } });
	assert.deepEqual(JSON.parse(child.stdout), { url, ...artifact });
	assert.deepEqual(observations, [
		{ protocol: '2.0', method: 'GET', range: undefined },
		{ protocol: '1.1', method: 'HEAD', range: undefined },
		{ protocol: '1.1', method: 'GET', range: undefined },
		{ protocol: '1.1', method: 'GET', range: 'bytes=0-0' },
	]);
});
