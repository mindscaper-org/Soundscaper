/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

process.env.SCAPE_PRODUCT = 'lightscaper';
const { createProtocolHandler } = await import('../desktop/protocol.js');

test('Lightscaper protocol serves its own renderer and local RAW runtime with capture denied', async () => {
	const root = await mkdtemp(join(tmpdir(), 'lightscaper-protocol-'));
	try {
		const rendererRoot = join(root, 'renderer'), runtimeRoot = join(root, 'runtime');
		await mkdir(rendererRoot); await mkdir(join(runtimeRoot, 'libraw/0.22.2'), { recursive: true });
		await writeFile(join(rendererRoot, 'index.html'), '<!doctype html><title>Lightscaper</title>');
		await writeFile(join(runtimeRoot, 'libraw/0.22.2/test.wasm'), new Uint8Array([0, 97, 115, 109]));
		const handle = createProtocolHandler({ productId: 'lightscaper', rendererRoot, runtimeRoot, readCapabilities: { get: () => null } });
		const document = await handle(new Request('lightscaper-app://bundle/'));
		assert.equal(document.status, 200); assert.match(await document.text(), /Lightscaper/u);
		assert.match(document.headers.get('Permissions-Policy')!, /microphone=\(\)/u);
		assert.match(document.headers.get('Permissions-Policy')!, /camera=\(\)/u);
		assert.match(document.headers.get('Content-Security-Policy')!, /connect-src 'self'/u);
		const wasm = await handle(new Request('lightscaper-app://bundle/runtime/libraw/0.22.2/test.wasm'));
		assert.equal(wasm.status, 200); assert.equal(wasm.headers.get('Content-Type'), 'application/wasm');
		assert.deepEqual(new Uint8Array(await wasm.arrayBuffer()), new Uint8Array([0, 97, 115, 109]));
		for (const url of ['soundscaper-app://bundle/', 'lightscaper-app://other/', 'lightscaper-app://bundle/_desktop/audiocom', 'lightscaper-app://bundle/runtime/missing.wasm']) {
			assert.ok((await handle(new Request(url))).status >= 400, url);
		}
	} finally { await rm(root, { recursive: true, force: true }); }
});
