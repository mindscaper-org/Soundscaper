/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { join } from 'node:path';

import { chromium, firefox, webkit } from 'playwright-core';

const worker = `
self.Module = {
	mainScriptUrlOrBlob: new URL('/edit-test.js', self.location.href).href,
	print: (line) => self.postMessage({ stdout: line }),
	printErr: (line) => self.postMessage({ stderr: line }),
	onAbort: (reason) => self.postMessage({ failure: String(reason) }),
	onExit: (status) => self.postMessage({ status }),
};
importScripts('/edit-test.js');
`;

/** Exercise the same linked Tracktion session in three cross-origin isolated workers. */
export async function verifyTracktionWasmInBrowsers(output) {
	const assets = new Map([
		['/', { body: '<!doctype html><meta charset="utf-8"><title>Tracktion WASM test</title>', type: 'text/html' }],
		['/worker.js', { body: worker, type: 'text/javascript' }],
	]);
	for (const name of ['edit-test.js', 'edit-test.worker.js', 'edit-test.wasm']) {
		assets.set(`/${name}`, {
			body: await readFile(join(output, name)),
			type: name.endsWith('.wasm') ? 'application/wasm' : 'text/javascript',
		});
	}
	const server = createServer((request, response) => {
		const asset = assets.get(request.url);
		response.writeHead(asset ? 200 : 404, {
			'Content-Type': asset?.type ?? 'text/plain',
			'Cross-Origin-Opener-Policy': 'same-origin',
			'Cross-Origin-Embedder-Policy': 'require-corp',
			'Cross-Origin-Resource-Policy': 'same-origin',
		});
		response.end(asset?.body);
	});
	server.listen(0, '127.0.0.1');
	try {
		await once(server, 'listening');
		const address = server.address();
		assert.ok(address && typeof address !== 'string');
		for (const browserType of [chromium, firefox, webkit]) {
			const browser = await browserType.launch();
			try {
				const page = await browser.newPage();
				await page.goto(`http://127.0.0.1:${address.port}/`);
				await page.evaluate(verifyWorkerSession);
				console.log(`${browserType.name()} passed Tracktion session editing, rendering and hosted playback in WebAssembly.`);
			} finally {
				await browser.close();
			}
		}
	} finally {
		await new Promise((close) => server.close(close));
	}
}

/** This function runs in the browser page. */
function verifyWorkerSession() {
	if (!self.crossOriginIsolated) throw new Error('Tracktion WASM requires shared memory in a cross-origin isolated page.');
	return new Promise((resolve, reject) => {
		const engine = new Worker('/worker.js');
		const report = [];
		let verified = false;
		function finish(error) {
			clearTimeout(deadline);
			engine.terminate();
			if (error) reject(new Error(`${error}\n${report.slice(-8).join('\n')}`));
			else resolve();
		}
		const deadline = setTimeout(() => finish('Tracktion WASM did not exit before the test deadline.'), 35_000);
		engine.onmessage = ({ data }) => {
			if (data.stdout === 'Tracktion session editing, rendering and hosted playback passed.') verified = true;
			if (data.stdout || data.stderr) report.push(data.stdout || data.stderr);
			if (data.failure) finish(data.failure);
			else if (Number.isInteger(data.status)) {
				finish(data.status === 0 && verified ? null : `Tracktion WASM exited with status ${String(data.status)}.`);
			}
		};
		engine.onerror = (event) => finish(event.message);
	});
}
