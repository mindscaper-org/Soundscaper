/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import abi1 from '../config/lightscaper-libraw-runtime-manifest.json';
import abi2 from '../config/lightscaper-libraw-recovery-runtime-manifest.json';
import { loadLibRawModuleV1 } from '../src/common/editor/raw/libraw-runtime-asset-v1.ts';
import { loadLibRawRecoveryModuleV2 } from '../src/common/editor/raw/libraw-runtime-asset-v2.ts';

for (const { label, manifest, load } of [
	{ label: 'ABI1', manifest: abi1, load: loadLibRawModuleV1 },
	{ label: 'recovery ABI2', manifest: abi2, load: loadLibRawRecoveryModuleV2 },
]) {
	test(`packaged Lightscaper ${label} authenticates local bytes, retries failure and never falls back to the network`, async () => {
		const bytes = new Uint8Array(await readFile(new URL(`../${manifest.runtime.path}`, import.meta.url)));
		const originalFetch = globalThis.fetch, originalLocation = Object.getOwnPropertyDescriptor(globalThis, 'location');
		const local = `lightscaper-app://bundle${new URL(manifest.runtime.url).pathname}`;
		const calls: { url: string; options?: RequestInit }[] = [];
		const unavailable = new Error('Local runtime unavailable');
		let transportFailure = true;
		let responseBytes = bytes.slice();
		try {
			Object.defineProperty(globalThis, 'location', { configurable: true, value: { href: 'lightscaper-app://bundle/en/' } });
			globalThis.fetch = (input, options) => {
				const url = String(input); calls.push({ url, options });
				if (url !== local) return Promise.reject(new Error(`Offline package attempted an external fetch: ${url}`));
				if (transportFailure) return Promise.reject(unavailable);
				return Promise.resolve(new Response(responseBytes.slice()));
			};
			await assert.rejects(load(), error => error === unavailable);
			transportFailure = false;
			responseBytes[responseBytes.length - 1] = responseBytes[responseBytes.length - 1]! ^ 1;
			await assert.rejects(load(), /SHA256/u);
			responseBytes.fill(0); responseBytes = bytes.slice(0, -1);
			await assert.rejects(load(), /truncated/u);
			responseBytes.fill(0); responseBytes = new Uint8Array(bytes.length + 1);
			await assert.rejects(load(), /pinned length/u);
			responseBytes.fill(0); responseBytes = bytes.slice();
			const loading = load(); assert.equal(load(), loading);
			const module = await loading;
			assert.ok(module instanceof WebAssembly.Module);
			assert.deepEqual(WebAssembly.Module.exports(module).map(value => value.name).sort(),
				[...manifest.wasm.requiredExports, ...Object.keys(manifest.wasm.auxiliaryExports)].sort());
			assert.equal(await load(), module);
			assert.equal(calls.length, 5);
			for (const call of calls) {
				assert.equal(call.url, local);
				assert.deepEqual(call.options, { credentials: 'omit', redirect: 'error', mode: 'cors', cache: 'force-cache' });
			}
		} finally {
			bytes.fill(0); responseBytes.fill(0); globalThis.fetch = originalFetch;
			if (originalLocation) Object.defineProperty(globalThis, 'location', originalLocation);
			else Reflect.deleteProperty(globalThis, 'location');
		}
	});
}
