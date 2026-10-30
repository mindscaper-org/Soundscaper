/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';

import { createCheckOutputReader, type CheckProgress } from '../scripts/lib/check-all-output.ts';

const root = resolve(import.meta.dirname, '..');

test('all four check-all browser shards use the shared previews across the ordinary engine matrix', { timeout: 30_000 }, async context => {
	const fixture = await mkdtemp(join(tmpdir(), 'scape-check-all-playwright-'));
	context.after(() => rm(fixture, { recursive: true, force: true }));
	const ports: number[] = [];
	for (const product of ['soundscaper', 'framescaper']) {
		const server = createServer((_request, response) => { response.end(product); });
		context.after(() => new Promise<void>((resolveClose, reject) => {
			server.closeAllConnections();
			server.close(error => error ? reject(error) : resolveClose());
		}));
		server.listen(0, '127.0.0.1');
		await once(server, 'listening');
		const address = server.address();
		assert.ok(address && typeof address !== 'string');
		ports.push(address.port);
	}
	const configFile = join(fixture, 'playwright.config.mjs');
	await writeFile(configFile, `
		import shared from ${JSON.stringify(pathToFileURL(resolve(root, 'playwright.check-all.config.ts')).href)};
		export default { ...shared, testDir: ${JSON.stringify(fixture)}, testMatch: '*.spec.mjs', retries: 0 };
	`);
	await writeFile(join(fixture, 'shared-preview.spec.mjs'), `
		import { test, expect } from ${JSON.stringify(pathToFileURL(resolve(root, 'node_modules/@playwright/test/index.mjs')).href)};
		for (let index = 1; index <= 4; index++) {
			test('shared previews ' + index, async ({ request }) => {
				const origins = JSON.parse(process.env.SCAPE_PLAYWRIGHT_PRODUCT_ORIGINS);
				const soundscaper = await request.get('/en/');
				expect(await soundscaper.text()).toBe('soundscaper');
				const framescaper = await request.get(origins.framescaper + '/en/');
				expect(await framescaper.text()).toBe('framescaper');
			});
		}
	`);
	const env: NodeJS.ProcessEnv = {
		...process.env, CI: '', SCAPE_CHECK_ALL_SERVERS: '1', SCAPE_BROWSER_COVERAGE: '',
		PLAYWRIGHT_PORT: String(ports[0]), PLAYWRIGHT_FRAMESCAPER_PORT: String(ports[1]),
	};
	delete env.NODE_TEST_CONTEXT;
	delete env.NODE_V8_COVERAGE;
	const runs = await Promise.all([1, 2, 3, 4].map(async shard => {
		const events: CheckProgress[] = [];
		const reader = createCheckOutputReader(event => events.push(event));
		let output = '';
		const child = spawn(process.execPath, [
			resolve(root, 'node_modules/@playwright/test/cli.js'), 'test', `--config=${configFile}`,
			`--shard=${shard}/4`, '--workers=1', `--output=${join(fixture, `results-${shard}`)}`,
		], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
		context.after(() => { child.kill('SIGKILL'); });
		child.stdout.on('data', (chunk: Buffer) => { output += chunk.toString(); reader.write(chunk); });
		child.stderr.on('data', (chunk: Buffer) => { output += chunk.toString(); });
		const code = await new Promise<number | null>((resolveExit, reject) => {
			child.once('error', reject);
			child.once('close', resolveExit);
		});
		reader.finish();
		return { code, output, events };
	}));
	for (const run of runs) {
		assert.equal(run.code, 0, run.output);
		assert.equal(run.events.filter(event => event.type === 'end').length, 3, run.output);
		assert.ok(run.events.every(event => event.type !== 'end' || !event.failure), run.output);
	}
	for (const engine of ['chromium', 'firefox', 'webkit']) {
		assert.equal(runs.flatMap(run => run.events).filter(event =>
			event.type === 'start' && event.label.startsWith(`${engine} > `)).length, 4);
	}
});
