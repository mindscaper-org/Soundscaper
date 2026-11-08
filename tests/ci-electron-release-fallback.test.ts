/* SPDX-License-Identifier: AGPL-3.0-only */

import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

const execute = promisify(execFile);
const root = resolve(import.meta.dirname, '..');

test('the Electron preload recovers a persistent release failure without bypassing package checksum validation', async context => {
	const directory = await mkdtemp(join(tmpdir(), 'scape-electron-api-'));
	context.after(() => rm(directory, { recursive: true, force: true }));
	const bytes = 'authenticated Electron fixture';
	const sha256 = createHash('sha256').update(bytes).digest('hex');
	const source = 'https://github.com/electron/electron/releases/download/v43.8.3/electron-v43.8.3-linux-x64.zip';
	const fixture = join(directory, 'fetch.mjs');
	await writeFile(fixture, `
		globalThis.fetch = async input => {
			const url = String(input);
			if (url === ${JSON.stringify(source)}) return new Response(null, { status: 504 });
			if (url === 'https://api.github.com/repos/electron/electron/releases/tags/v43.8.3') {
				return Response.json({ tag_name: 'v43.8.3', assets: [{ id: 123,
					name: 'electron-v43.8.3-linux-x64.zip', browser_download_url: ${JSON.stringify(source)} }] });
			}
			if (url !== 'https://api.github.com/repos/electron/electron/releases/assets/123') throw new Error('Unexpected transfer');
			return new Response(${JSON.stringify(bytes)});
		};
	`);
	await execute(process.execPath, ['--import', pathToFileURL(fixture).href, '--import', './scripts/ci-github-release-fetch.mjs', '--input-type=module', '-e', `
		import assert from 'node:assert/strict';
		import { readFile } from 'node:fs/promises';
		import { downloadArtifact } from '@electron/get';
		const options = { version: '43.8.3', artifactName: 'electron', platform: 'linux', arch: 'x64',
			cacheRoot: ${JSON.stringify(join(directory, 'cache'))}, force: true,
			checksums: { 'electron-v43.8.3-linux-x64.zip': ${JSON.stringify(sha256)} } };
		const archive = await downloadArtifact(options);
		assert.equal(await readFile(archive, 'utf8'), ${JSON.stringify(bytes)});
		await assert.rejects(downloadArtifact({ ...options,
			checksums: { 'electron-v43.8.3-linux-x64.zip': '0'.repeat(64) } }), /did not match expected checksum/u);
	`], { cwd: root, timeout: 20_000 });
});
