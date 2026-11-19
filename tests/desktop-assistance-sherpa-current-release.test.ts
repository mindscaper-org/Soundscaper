/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const json = async (path: string): Promise<Record<string, unknown>> =>
	JSON.parse(await readFile(new URL(`../${path}`, import.meta.url), 'utf8')) as Record<string, unknown>;

test('Sherpa 2.0.1 uses the reviewed wrapper and native source across every maintained GPU target', async () => {
	const recipe = await json('config/assistance-sherpa-gpu-build.json');
	const manifest = await json('config/assistance-native-runtime-manifest.json');
	const metadata = await json('package.json');
	assert.equal(recipe.version, '2.0.1');
	assert.equal(recipe.sourceRevision, 'af2d8d81dbfa61c4cea4c568da78f3982edca005');
	assert.equal(manifest.version, recipe.version);
	assert.equal((manifest.commonPackage as Record<string, unknown>).version, recipe.version);
	assert.equal((metadata.optionalDependencies as Record<string, unknown>)['sherpa-onnx-node'], recipe.version);
	const targets = recipe.targets as { id: string; executionProviders: string[] }[];
	assert.deepEqual(targets.map(({ id }) => id).sort(),
		['linux-arm64', 'linux-x64', 'mac-arm64', 'win-arm64', 'win-x64']);
	for (const target of targets) assert.ok(target.executionProviders.includes('webgpu'));
});
