/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import childProcess, { type SpawnOptions } from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import net from 'node:net';
import { resolve } from 'node:path';
import test from 'node:test';

test('check-all preview children select each product independently of their parent environment', { timeout: 5_000 }, async context => {
	const environment = { ...process.env };
	const spawned: { command: string; args: readonly string[]; options: SpawnOptions }[] = [];
	const requests: string[] = [];
	let output = '';
	// An inherited selection must not make both dynamic download handlers serve
	// one product, even while their static assets come from different directories.
	process.env.SCAPE_PRODUCT = 'framescaper';
	process.env.SCAPE_BROWSER_PRODUCTS = '';
	process.env.PLAYWRIGHT_PORT = '4530';
	process.env.PLAYWRIGHT_FRAMESCAPER_PORT = '4531';
	context.mock.method(childProcess, 'spawn', (command: string, args: readonly string[], options: SpawnOptions) => {
		spawned.push({ command, args, options });
		return new childProcess.ChildProcess();
	});
	context.mock.method(net, 'createServer', () => {
		const probe = new net.Server();
		context.mock.method(probe, 'listen', (_port: number, _host: string, onListening: () => void) => {
			onListening();
			return probe;
		});
		context.mock.method(probe, 'close', (onClosed: (error?: Error) => void) => {
			onClosed();
			return probe;
		});
		return probe;
	});
	context.mock.method(globalThis, 'fetch', async (url: string) => {
		requests.push(url);
		return new Response(null, { status: 200 });
	});
	context.mock.method(process.stdout, 'write', (chunk: string) => { output += chunk; return true; });
	syncBuiltinESMExports();
	try {
		await import('../scripts/check-all-browser-servers.ts');
	} finally {
		context.mock.restoreAll();
		syncBuiltinESMExports();
		for (const key of ['SCAPE_PRODUCT', 'SCAPE_BROWSER_PRODUCTS', 'PLAYWRIGHT_PORT', 'PLAYWRIGHT_FRAMESCAPER_PORT']) {
			if (environment[key] === undefined) delete process.env[key];
			else process.env[key] = environment[key];
		}
	}
	assert.equal(spawned.length, 2);
	for (const [index, product] of ['soundscaper', 'framescaper'].entries()) {
		const launch = spawned[index]!;
		assert.equal(launch.command, process.execPath);
		assert.equal(launch.args[0], resolve(import.meta.dirname, '../node_modules/vite/bin/vite.js'));
		assert.equal(launch.args[launch.args.indexOf('--outDir') + 1], `.wrangler/browser-products/${product}`);
		assert.equal(launch.options.env?.SCAPE_PRODUCT, product, `${product} must select its own dynamic routes`);
		assert.equal(launch.options.env?.PATH, environment.PATH, 'unrelated environment remains available to Vite');
		assert.notEqual(launch.options.env, process.env);
	}
	assert.deepEqual(requests, ['http://127.0.0.1:4530/en/', 'http://127.0.0.1:4531/en/']);
	assert.match(output, /"id":"servers-ready"/u);
});
