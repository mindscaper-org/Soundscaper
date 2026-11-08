/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { runInNewContext } from 'node:vm';

import {
	generateOfflineApplicationShell,
	MAXIMUM_INSTALL_ASSET_BYTES,
} from '../scripts/lib/offline-application-shell.mjs';
import {
	renderOfflineServiceWorker,
	validateOfflineShellConfiguration,
} from '../scripts/lib/offline-service-worker.mjs';

const APPROVED_INSTALL_BYTES = 12 * 1024 * 1024;
const CHUNK_BYTES = 3 * 1024 * 1024;

function validateSerializedWorker(configuration: unknown): void {
	const source = renderOfflineServiceWorker(configuration);
	runInNewContext(`${source}\nvalidateOfflineShellConfiguration(OFFLINE_SHELL);`, {
		addEventListener: () => undefined,
	});
}

function boundaryConfiguration(totalBytes: number) {
	const assets = [
		{ url: '/assets/a.js', byteLength: 4 * 1024 * 1024 },
		{ url: '/assets/b.js', byteLength: 4 * 1024 * 1024 },
		{ url: '/assets/c.js', byteLength: totalBytes - 8 * 1024 * 1024 - 2 },
		{ url: '/embed/en/', byteLength: 1 },
		{ url: '/en/', byteLength: 1 },
	].map((asset) => ({ ...asset, sha256: 'a'.repeat(64) }));
	return {
		schemaVersion: 2, productId: 'framescaper', scope: '/', foreignScopes: ['/docs/'],
		workerSha256: 'b'.repeat(64), releaseId: 'c'.repeat(64),
		fallbacks: { standard: '/en/', embedded: '/embed/en/' },
		assets, installUrls: assets.map(({ url }) => url),
	};
}

test('the approved builder install maximum is accepted by the worker and its emitted runtime', () => {
	assert.equal(MAXIMUM_INSTALL_ASSET_BYTES, APPROVED_INSTALL_BYTES);
	const configuration = boundaryConfiguration(APPROVED_INSTALL_BYTES);
	assert.doesNotThrow(() => validateOfflineShellConfiguration(configuration));
	assert.doesNotThrow(() => validateSerializedWorker(configuration));
});

test('one byte beyond the approved install maximum is refused by both worker entry points', () => {
	const configuration = boundaryConfiguration(APPROVED_INSTALL_BYTES + 1);
	assert.throws(() => validateOfflineShellConfiguration(configuration), /install byte limit is exceeded/u);
	assert.throws(() => validateSerializedWorker(configuration), /install byte limit is exceeded/u);
});

test('a generated Framescaper install above eight MiB passes its actual worker admission', async (context) => {
	const outputRoot = await mkdtemp(join(tmpdir(), 'offline-install-parity-'));
	context.after(() => rm(outputRoot, { recursive: true, force: true }));
	const fixtureFile = async (path: string, bytes: string | Uint8Array): Promise<void> => {
		const target = join(outputRoot, path);
		await mkdir(dirname(target), { recursive: true });
		await writeFile(target, bytes);
	};
	const entry = 'src/framescaper/ui/FramescaperAudioEditorBootstrap.tsx';
	await Promise.all([
		...['', 'en/', 'embed/en/'].map((route) => fixtureFile(`${route}index.html`, '<!doctype html><title>Fixture</title>')),
		...['application', 'frame', 'shared'].map((name) => fixtureFile(`assets/${name}.js`, Buffer.alloc(CHUNK_BYTES, 32))),
		...['framescaper', 'soundscaper', 'lightscaper', 'mindscaper'].map((name) => (
			fixtureFile(`logo/${name}.svg`, '<svg viewBox="0 0 1 1" />')
		)),
		...['wide', 'narrow'].map((name) => fixtureFile(`install-screenshots/framescaper-${name}.png`, name)),
		fixtureFile('.offline-build-manifest.json', JSON.stringify({
			'index.html': { file: 'assets/application.js', isEntry: true, imports: ['_shared'], dynamicImports: [entry] },
			_shared: { file: 'assets/shared.js' },
			[entry]: { file: 'assets/frame.js', imports: ['_shared'], isDynamicEntry: true },
		})),
	]);
	await generateOfflineApplicationShell({
		outputRoot, repositoryRoot: resolve('.'), environment: { SCAPE_PRODUCT: 'framescaper' },
	});
	const source = await readFile(join(outputRoot, 'service-worker.js'), 'utf8');
	const line = source.split('\n').find((value) => value.startsWith('const OFFLINE_SHELL = '));
	assert.ok(line, 'the actual builder emitted its worker configuration');
	const configuration: unknown = JSON.parse(line.slice('const OFFLINE_SHELL = '.length, -1));
	const audit = JSON.parse(await readFile(join(outputRoot, 'offline-shell.json'), 'utf8')) as {
		workers: { framescaper: { installByteLength: number; installUrls: string[] } };
	};
	assert.ok(audit.workers.framescaper.installByteLength > 8 * 1024 * 1024);
	assert.ok(audit.workers.framescaper.installByteLength < APPROVED_INSTALL_BYTES);
	for (const name of ['application', 'frame', 'shared']) {
		assert.ok(audit.workers.framescaper.installUrls.includes(`/assets/${name}.js`), 'mandatory static imports remain installed');
	}
	assert.doesNotThrow(() => validateOfflineShellConfiguration(configuration));
	assert.doesNotThrow(() => validateSerializedWorker(configuration));
});
