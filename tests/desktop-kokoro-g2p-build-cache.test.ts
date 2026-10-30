/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';

import { buildKokoroG2pBundle, describeKokoroG2pBuildInputs, kokoroG2pCacheIdentity } from '../scripts/kokoro-g2p/build.mjs';
import { describeDesktopKokoroG2pBundle } from '../scripts/lib/desktop-kokoro-g2p-runtime.mjs';

test('Kokoro cache keys bind every recipe input, target, host and builder version', async context => {
	const repositoryRoot = resolve(import.meta.dirname, '..');
	const inputs = await describeKokoroG2pBuildInputs({ repositoryRoot });
	const options = { inputs, targetId: 'win-arm64', platform: 'win32', architecture: 'arm64',
		nodeVersion: 'v26.5.0', uvVersion: 'uv 0.12.5', scope: 'windows-11-arm/image-1' };
	const original = kokoroG2pCacheIdentity(options);
	assert.equal(kokoroG2pCacheIdentity(options), original);
	for (const change of [{ targetId: 'win-x64' }, { architecture: 'x64' }, { platform: 'linux' },
		{ scope: 'windows-11-arm/image-2' }, { nodeVersion: 'v26.6.0' }, { uvVersion: 'uv 0.12.6' }]) {
		assert.notEqual(kokoroG2pCacheIdentity({ ...options, ...change }), original);
	}
	const fixture = await mkdtemp(join(tmpdir(), 'kokoro-cache-inputs-'));
	context.after(() => rm(fixture, { recursive: true, force: true }));
	for (const path of inputs.files) {
		await mkdir(dirname(join(fixture, path)), { recursive: true });
		await copyFile(join(repositoryRoot, path), join(fixture, path));
	}
	const copied = await describeKokoroG2pBuildInputs({ repositoryRoot: fixture });
	assert.equal(kokoroG2pCacheIdentity({ ...options, inputs: copied }), original, 'checkout path is not a build input');
	for (const path of ['scripts/kokoro-g2p/uv.lock', 'desktop/assistance-kokoro-g2p-helper.py',
		'scripts/kokoro-g2p/build.mjs', 'desktop/assistance_kokoro_g2p_gpu.py',
		'config/assistance-onnx-webgpu-plugin.json', 'scripts/kokoro-g2p/notices/espeak-ng-COPYING']) {
		const bytes = await readFile(join(fixture, path));
		await writeFile(join(fixture, path), Buffer.concat([bytes, Buffer.from('\nchanged')]));
		const changed = await describeKokoroG2pBuildInputs({ repositoryRoot: fixture });
		assert.notEqual(kokoroG2pCacheIdentity({ ...options, inputs: changed }), original, path);
		await writeFile(join(fixture, path), bytes);
	}
});

test('a restored Kokoro bundle is verified offline and changed GPU bytes or recipe inputs trigger rebuilding', async context => {
	const outputRoot = await mkdtemp(join(tmpdir(), 'kokoro-verified-cache-'));
	context.after(() => rm(outputRoot, { recursive: true, force: true }));
	const targetId = 'win-arm64', bundleRoot = join(outputRoot, targetId);
	const inputs = await describeKokoroG2pBuildInputs();
	await mkdir(join(bundleRoot, '_internal/scape-gpu'), { recursive: true });
	await mkdir(join(bundleRoot, 'licenses/python/example'), { recursive: true });
	await writeFile(join(bundleRoot, 'kokoro-g2p.exe'), 'frozen helper');
	const gpuPath = join(bundleRoot, '_internal/scape-gpu/scape-g2p-gpu.dll');
	await writeFile(gpuPath, 'authenticated GPU closure');
	const license = Buffer.from('Example license');
	await writeFile(join(bundleRoot, 'licenses/python/example/LICENSE'), license);
	await writeFile(join(bundleRoot, 'python-license-inventory.json'), JSON.stringify({ schemaVersion: 1,
		packages: [{ name: 'example', version: '1.0.0', notices: [{ path: 'licenses/python/example/LICENSE',
			byteLength: license.length, sha256: createHash('sha256').update(license).digest('hex') }] }] }));
	const provenance = { targetId, recipeSha256: inputs.recipeSha256,
		gpu: { recipeId: 'kokoro-g2p-ort-gemm-gpu-build-v1' },
		dependencyLock: { sha256: inputs.dependencyLockSha256 }, entrypoint: { sha256: inputs.entrypointSha256 },
		dictionary: { sha256: 'fe6ba0e43542cef98339abdffd903e062008ea170b04e7e2a35da805902f382a' } };
	await writeFile(join(bundleRoot, 'build-provenance.json'), JSON.stringify(provenance));
	const manifest = await describeDesktopKokoroG2pBundle({ targetId, bundleRoot });
	await writeFile(join(outputRoot, `${targetId}.manifest.json`), JSON.stringify(manifest));
	let downloads = 0;
	const options = { targetId, outputRoot, cacheRoot: join(outputRoot, 'cache'), platform: 'win32', arch: 'arm64',
		fetchImpl: async () => { downloads += 1; throw new Error('rebuild requested'); } } as const;
	assert.equal((await buildKokoroG2pBundle(options)).reused, true);
	assert.equal(downloads, 0);
	await writeFile(gpuPath, 'changed GPU closure');
	await assert.rejects(buildKokoroG2pBundle(options), /rebuild requested/u);
	assert.equal(downloads, 1);
	await writeFile(gpuPath, 'authenticated GPU closure');
	await writeFile(join(bundleRoot, 'build-provenance.json'), JSON.stringify({ ...provenance, recipeSha256: '0'.repeat(64) }));
	const stale = await describeDesktopKokoroG2pBundle({ targetId, bundleRoot });
	await writeFile(join(outputRoot, `${targetId}.manifest.json`), JSON.stringify(stale));
	await assert.rejects(buildKokoroG2pBundle(options), /rebuild requested/u);
	assert.equal(downloads, 2);
});
