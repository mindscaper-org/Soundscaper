/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { preview } from 'vite';

import {
	authoredWildcardResponseHeaders,
	parseWildcardResponseHeaders,
} from '../scripts/lib/static-response-headers.mjs';
import { securityHeaders } from '../desktop/protocol.js';

const directives = (policy) => new Map(policy
	.split(';')
	.map((directive) => directive.trim().split(/\s+/u))
	.filter(([name]) => name)
	.map(([name, ...sources]) => [name, sources]));

test('the wildcard rule is read, and the per-path rules that follow it are not', () => {
	const headers = parseWildcardResponseHeaders([
		'# a comment',
		'/*',
		'\tContent-Security-Policy: default-src \'self\'',
		'\tCross-Origin-Opener-Policy: same-origin',
		'',
		'/transfer/send/',
		'\t! Cross-Origin-Opener-Policy',
		'\tCross-Origin-Opener-Policy: same-origin-allow-popups',
		'\tCache-Control: no-cache',
	].join('\n'));

	assert.deepEqual(headers, {
		'Content-Security-Policy': "default-src 'self'",
		'Cross-Origin-Opener-Policy': 'same-origin',
	});
	assert.throws(() => parseWildcardResponseHeaders('/*\n\tX-Content-Type-Options: nosniff\n'),
		/no Content-Security-Policy/u);
});

test('both shipped policies keep the shape a sandboxed macro worker depends on', () => {
	// A macro runs as a worker built from a blob: URL, because there is no way to
	// evaluate a string of source without 'unsafe-eval'. Both halves of that are
	// load-bearing, and neither is visible from the sandbox's own code — so they
	// are pinned here. A future policy edit that grants 'unsafe-eval' or drops
	// blob: workers has to come past this test and say why.
	for (const [shell, policy] of [
		['web', authoredWildcardResponseHeaders('soundscaper')['Content-Security-Policy']],
		['desktop', securityHeaders({ html: '' })['Content-Security-Policy']],
	]) {
		const parsed = directives(policy);
		assert.ok(parsed.get('worker-src')?.includes('blob:'),
			`${shell} must allow a blob: worker`);
		for (const [name, sources] of parsed) {
			assert.ok(!sources.includes("'unsafe-eval'"),
				`${shell} must not grant 'unsafe-eval' (found in ${name})`);
		}
		assert.deepEqual(parsed.get('object-src'), ["'none'"], `${shell} must forbid plugins`);
	}
});

test('the desktop shell reaches no network beyond its own origin', () => {
	// The web worker inherits connect-src from the document and keeps the
	// first-party CDN; the desktop one has nowhere to go at all. That asymmetry
	// is recorded in the threat model, so it is pinned rather than assumed.
	assert.deepEqual(
		directives(securityHeaders({ html: '' })['Content-Security-Policy']).get('connect-src'),
		["'self'", 'blob:'],
	);
	const web = directives(authoredWildcardResponseHeaders('soundscaper')['Content-Security-Policy']).get('connect-src');
	assert.ok(web.includes("'self'"));
	assert.ok(web.every((source) => source === "'self'" || source.startsWith('https://')),
		'the web policy must not widen connect-src beyond first-party https origins');
});

test('Vite preview retains each product’s response headers on conditional assets', async () => {
	const directory = await mkdtemp(join(tmpdir(), 'scape-preview-response-headers-'));
	const previous = process.env.SCAPE_PRODUCT;
	try {
		await Promise.all([
			mkdir(join(directory, 'assets')).then(() => writeFile(join(directory, 'assets', 'index.js'), 'export {};')),
			mkdir(join(directory, 'tracktion')).then(() => writeFile(join(directory, 'tracktion', 'edit-core.js'), 'export {};')),
		]);
		for (const [product, route, embedderPolicy] of [
			['soundscaper', '/tracktion/edit-core.js', 'require-corp'],
			['framescaper', '/assets/index.js', 'credentialless'],
		]) {
			process.env.SCAPE_PRODUCT = product;
			const server = await preview({
				configFile: fileURLToPath(new URL('../vite.config.mjs', import.meta.url)),
				build: { outDir: directory }, logLevel: 'silent', preview: { host: '127.0.0.1', port: 0 },
			});
			try {
				const address = server.httpServer.address();
				assert.ok(address && typeof address !== 'string');
				const url = `http://127.0.0.1:${address.port}${route}`;
				const fresh = await fetch(url);
				assert.equal(fresh.status, 200);
				assert.equal(await fresh.text(), 'export {};');
				const validator = fresh.headers.get('etag');
				assert.ok(validator);
				const unchanged = await fetch(url, { headers: { 'If-None-Match': validator } });
				assert.equal(unchanged.status, 304);
				assert.equal(await unchanged.text(), '');
				assert.equal(unchanged.headers.get('cross-origin-embedder-policy'), embedderPolicy);
				for (const [name, value] of Object.entries(authoredWildcardResponseHeaders(product))) {
					assert.equal(fresh.headers.get(name), value, `${product} fresh ${name}`);
					assert.equal(unchanged.headers.get(name), value, `${product} conditional ${name}`);
				}
			} finally {
				await server.close();
			}
		}
	} finally {
		if (previous === undefined) delete process.env.SCAPE_PRODUCT;
		else process.env.SCAPE_PRODUCT = previous;
		await rm(directory, { recursive: true, force: true });
	}
});
