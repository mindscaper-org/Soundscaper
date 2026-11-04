/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import childProcess, { spawn, type SpawnOptions } from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { cp, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import net, { createServer, type AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

interface PreviewIdentity {
	readonly productId: string;
	readonly outputDirectory: string;
	readonly inherited: string;
}

test('check-all preview children use their own product identity and retain inherited environment', { timeout: 15_000 }, async context => {
	const root = resolve(import.meta.dirname, '..');
	const fixture = await mkdtemp(join(tmpdir(), 'scape-check-all-preview-'));
	context.after(() => rm(fixture, { recursive: true, force: true }));
	await mkdir(join(fixture, 'scripts/lib'), { recursive: true });
	await mkdir(join(fixture, 'node_modules/vite/bin'), { recursive: true });
	for (const file of ['check-all-browser-servers.ts', 'lib/browser-product-site-plan.mjs', 'lib/check-all-output.ts']) {
		await cp(join(root, 'scripts', file), join(fixture, 'scripts', file));
	}
	await writeFile(join(fixture, 'package.json'), JSON.stringify({ type: 'module' }));
	// Exit after recording the actual child environment. The supervisor must
	// notice that exit, so this fixture needs no Vite build or persistent server.
	await writeFile(join(fixture, 'node_modules/vite/bin/vite.js'), `
		console.log('PREVIEW_IDENTITY ' + JSON.stringify({
			productId: process.env.SCAPE_PRODUCT,
			outputDirectory: process.argv[process.argv.indexOf('--outDir') + 1],
			inherited: process.env.SCAPE_PREVIEW_TEST_SENTINEL,
		}));
	`);
	const [soundscaperPort, framescaperPort] = await availablePorts();
	const environment: NodeJS.ProcessEnv = { ...process.env,
		SCAPE_PRODUCT: 'soundscaper', SCAPE_BROWSER_PRODUCTS: '', SCAPE_PREVIEW_TEST_SENTINEL: 'preserved',
		PLAYWRIGHT_PORT: String(soundscaperPort), PLAYWRIGHT_FRAMESCAPER_PORT: String(framescaperPort),
	};
	delete environment.NODE_TEST_CONTEXT;
	delete environment.NODE_V8_COVERAGE;
	const child = spawn(process.execPath, ['scripts/check-all-browser-servers.ts'], {
		cwd: fixture, env: environment, stdio: ['ignore', 'pipe', 'pipe'], timeout: 10_000,
	});
	context.after(() => { child.kill('SIGKILL'); });
	let output = '';
	child.stdout.on('data', (chunk: Buffer) => { output += chunk.toString(); });
	child.stderr.on('data', (chunk: Buffer) => { output += chunk.toString(); });
	const code = await new Promise<number | null>((resolveExit, reject) => {
		child.once('error', reject);
		child.once('close', resolveExit);
	});
	assert.equal(code, 1, output);
	assert.match(output, /preview stopped/u);
	const identities = output.split('\n').filter(line => line.startsWith('PREVIEW_IDENTITY '))
		.map(line => JSON.parse(line.slice('PREVIEW_IDENTITY '.length)) as PreviewIdentity)
		.sort((left, right) => left.productId.localeCompare(right.productId));
	assert.deepEqual(identities, [
		{ productId: 'framescaper', outputDirectory: '.wrangler/browser-products/framescaper', inherited: 'preserved' },
		{ productId: 'soundscaper', outputDirectory: '.wrangler/browser-products/soundscaper', inherited: 'preserved' },
	]);
});

async function availablePorts(): Promise<readonly number[]> {
	const servers = [createServer(), createServer()];
	try {
		await Promise.all(servers.map(server => new Promise<void>((resolveListening, reject) => {
			server.once('error', reject);
			server.listen(0, '127.0.0.1', resolveListening);
		})));
		return servers.map(server => (server.address() as AddressInfo).port);
	} finally {
		await Promise.all(servers.filter(server => server.listening).map(server => new Promise<void>((resolveClosed, reject) => {
			server.close(error => error ? reject(error) : resolveClosed());
		})));
	}
}

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
