/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';

import { prepareTracktionWasmCore, tracktionEngineInputDigest } from '../scripts/lib/vite-tracktion-web.mjs';

const worklet = 'src/soundscaper/tracktion-audio-worklet.ts';
const platformSource = 'native/soundscaper-tracktion/wasm/juce_headless_core.inc';

async function fixture(context) {
	const root = await mkdtemp(join(tmpdir(), 'tracktion-web-build-cache-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	async function put(name, content) {
		const file = join(root, name);
		await mkdir(dirname(file), { recursive: true });
		await writeFile(file, content);
	}
	await Promise.all([
		'config/soundscaper-tracktion-sources.json',
		'scripts/lib/tracktion-sources.mjs',
		'scripts/lib/tracktion-editor-build.mjs',
		'scripts/lib/tracktion-wasm-platform.mjs',
		'scripts/lib/tracktion-web-static.mjs',
		'scripts/lib/milestone-5-source-archive-extraction.mjs',
		'scripts/lib/exclusive-rename.mjs',
		'native/framescaper-media-host/build/source-authentication.mjs',
		'native/soundscaper-tracktion/wasm/tracktion-project-worker.ts',
		worklet, platformSource,
	].map((file) => put(file, 'initial source')));
	await put('scripts/probe-tracktion-wasm.mjs', `
		import assert from 'node:assert/strict';
		import { appendFile, readFile, writeFile } from 'node:fs/promises';
		import { join } from 'node:path';
		const [, , flag, destination] = process.argv;
		assert.equal(flag, '--build-browser-core');
		await appendFile('compilations', 'compiled\\n');
		const body = await readFile('${platformSource}');
		for (const name of ['edit-core.js', 'edit-core.worker.js', 'edit-core.wasm']) {
			await writeFile(join(destination, name), body);
		}
	`);
	return { root, put };
}

test('Tracktion bridge and worker edits reuse the native WASM input digest', async (context) => {
	const { root, put } = await fixture(context);
	const initial = await tracktionEngineInputDigest(root);
	const before = await prepareTracktionWasmCore(root);
	await put(worklet, 'updated AudioWorklet');
	await put('native/soundscaper-tracktion/wasm/tracktion-project-worker.ts', 'updated browser worker');
	assert.equal(await tracktionEngineInputDigest(root), initial);
	assert.deepEqual(await prepareTracktionWasmCore(root), before);
	assert.equal(await readFile(join(root, 'compilations'), 'utf8'), 'compiled\n');
});

test('changes to copied Tracktion platform code invalidate the WASM digest', async (context) => {
	const { root, put } = await fixture(context);
	const initial = await tracktionEngineInputDigest(root);
	const before = await prepareTracktionWasmCore(root);
	await put(platformSource, 'updated JUCE platform implementation');
	assert.notEqual(await tracktionEngineInputDigest(root), initial);
	const after = await prepareTracktionWasmCore(root);
	assert.notDeepEqual(after.get('edit-core.wasm'), before.get('edit-core.wasm'));
	assert.equal(await readFile(join(root, 'compilations'), 'utf8'), 'compiled\ncompiled\n');
});

test('an incomplete cached core is rebuilt and published as a complete set', async (context) => {
	const { root } = await fixture(context);
	const stamp = await tracktionEngineInputDigest(root);
	const expected = await prepareTracktionWasmCore(root);
	await rm(join(root, '.native-build/tracktion-wasm-core', stamp, 'edit-core.worker.js'));
	assert.deepEqual(await prepareTracktionWasmCore(root), expected);
	assert.deepEqual(await prepareTracktionWasmCore(root), expected);
	assert.equal(await readFile(join(root, 'compilations'), 'utf8'), 'compiled\ncompiled\n');
});
