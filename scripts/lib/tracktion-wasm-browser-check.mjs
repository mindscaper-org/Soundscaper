/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { once } from 'node:events';
import { chromium, firefox, webkit } from 'playwright-core';

import { verifyWorkerCommands } from './tracktion-wasm-command-check.ts';
import { verifyTracktionWebEditor } from './tracktion-web-editor-check.ts';
import { createTracktionWebServer, loadAsset, loadTracktionWebAssets } from './tracktion-web-static.mjs';

const worker = `
self.Module = {
	mainScriptUrlOrBlob: new URL('/edit-test.js', self.location.href).href,
	print: (line) => self.postMessage({ stdout: line }),
	printErr: (line) => self.postMessage({ stderr: line }),
	onRuntimeInitialized: () => self.postMessage({ phase: 'WASM runtime initialized' }),
	onAbort: (reason) => self.postMessage({ failure: String(reason) }),
	onExit: (status) => self.postMessage({ status }),
};
importScripts('/edit-test.js');
`;

/** Exercise the same linked Tracktion session in three cross-origin isolated workers. */
export async function verifyTracktionWasmInBrowsers(output) {
	const assets = await loadTracktionWebAssets(output);
	assets.set('/editor', assets.get('/index.html'));
	assets.set('/', { body: '<!doctype html><meta charset="utf-8"><title>Tracktion WASM test</title>', type: 'text/html' });
	assets.set('/worker.js', { body: worker, type: 'text/javascript' });
	for (const name of ['edit-test.js', 'edit-test.worker.js', 'edit-test.wasm']) {
		assets.set(`/${name}`, await loadAsset(output, name));
	}
	const server = createTracktionWebServer(assets);
	server.listen(0, '127.0.0.1');
	try {
		await once(server, 'listening');
		const address = server.address();
		assert.ok(address && typeof address !== 'string');
		const origin = `http://127.0.0.1:${address.port}`;
		for (const browserType of [chromium, firefox, webkit]) {
			const browser = await browserType.launch();
			try {
				const page = await browser.newPage();
				await page.goto(origin);
				await page.evaluate(verifyWorkerSession);
				console.log(`${browserType.name()} passed Tracktion session editing, rendering and hosted playback in WebAssembly.`);
				await page.evaluate(verifyWorkerCommands);
				console.log(`${browserType.name()} passed Tracktion worker commands, WAV exchange and persistent project reopen.`);
				await verifyTracktionWebEditor(page, origin);
				console.log(`${browserType.name()} passed the Tracktion web editor from WAV import through save, reload and export.`);
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
			if (data.stdout || data.stderr || data.phase) report.push(data.stdout || data.stderr || data.phase);
			if (data.failure) finish(data.failure);
			else if (Number.isInteger(data.status)) {
				if (data.status !== 0) finish(`Tracktion WASM exited with status ${String(data.status)}.`);
				else finish(verified ? null : 'Tracktion WASM exited before reporting a successful session test.');
			}
		};
		engine.onerror = (event) => finish(event.message);
	});
}
