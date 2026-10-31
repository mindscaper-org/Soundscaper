/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createServer, preview, type InlineConfig } from 'vite';

import { localDownloadPagePlugin } from '../scripts/lib/vite-download-page.ts';

for (const mode of ['dev', 'preview'] as const) {
	for (const product of ['soundscaper', 'framescaper'] as const) {
		test(`${mode} serves the ${product} download page before its editor fallback`, async () => {
			const root = await mkdtemp(join(tmpdir(), 'scape-download-preview-'));
			const name = product === 'soundscaper' ? 'Soundscaper' : 'Framescaper';
			let upstreamAvailable = true;
			let lookups = 0;
			const fetchImpl: typeof fetch = async () => {
				lookups += 1;
				return upstreamAvailable ? Response.json([{
					tag_name: `${product}-v1.0.0-rc.1`, draft: false, published_at: '2026-10-31T00:00:00Z',
					assets: [{ name: `${name}-1.0.0-rc.1-win-x64.exe`, state: 'uploaded' }],
				}]) : new Response(null, { status: 503 });
			};
			const config: InlineConfig = {
				root, configFile: false, logLevel: 'silent',
				plugins: [localDownloadPagePlugin(product, fetchImpl)],
				server: { host: '127.0.0.1', port: 0 },
				preview: { host: '127.0.0.1', port: 0 },
				optimizeDeps: { noDiscovery: true, include: [] },
			};
			try {
				await mkdir(join(root, 'dist'));
				for (const path of ['index.html', 'dist/index.html']) {
					await writeFile(join(root, path), '<html><body><h1>Editor fixture</h1></body></html>');
				}
				const server = mode === 'dev' ? await createServer(config) : await preview(config);
				try {
					if ('listen' in server) await server.listen();
					const address = server.httpServer?.address();
					assert.ok(address && typeof address !== 'string');
					const origin = `http://127.0.0.1:${address.port}`;
					for (const path of ['/download', '/download/?preview=true']) {
						const response = await fetch(`${origin}${path}`);
						assert.equal(response.status, 200);
						assert.equal(response.headers.get('cache-control'), 'no-store');
						assert.match(await response.text(), new RegExp(`<h1>Download ${name}</h1>`, 'u'));
					}
					const head = await fetch(`${origin}/download/`, { method: 'HEAD' });
					assert.equal(head.status, 200);
					assert.equal(await head.text(), '');
					const before = lookups;
					const post = await fetch(`${origin}/download/`, { method: 'POST' });
					assert.equal(post.status, 405);
					assert.equal(post.headers.get('allow'), 'GET, HEAD');
					assert.match(await (await fetch(`${origin}/en/`)).text(), /Editor fixture/u);
					assert.equal(lookups, before);
					upstreamAvailable = false;
					const unavailable = await fetch(`${origin}/download/`);
					assert.equal(unavailable.status, 503);
					assert.match(await unavailable.text(), /could not load the latest release candidate/u);
				} finally {
					await server.close();
				}
			} finally {
				await rm(root, { recursive: true, force: true });
			}
		});
	}
}
