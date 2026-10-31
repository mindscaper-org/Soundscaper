/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { cp, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer, type AddressInfo } from 'node:net';
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
