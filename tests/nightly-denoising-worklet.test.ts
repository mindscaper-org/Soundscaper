/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { packagedDenoisingWorklet } from './electron/local-assistance-models/denoise-port-driver.ts';

test('the denoising regression loads the shipped processor and refuses missing or ambiguous payloads', async context => {
	const resources = await mkdtemp(join(tmpdir(), 'nightly-denoising-worklet-'));
	context.after(() => rm(resources, { recursive: true, force: true }));
	const assets = join(resources, 'renderer/assets');
	await mkdir(assets, { recursive: true });
	await writeFile(join(assets, 'editor.js'), 'const type = "kw-ai-denoise";');
	await writeFile(join(assets, 'processor.js.map'), 'registerProcessor("kw-ai-denoise", Processor);');
	await assert.rejects(packagedDenoisingWorklet(resources), /exactly one kw-ai-denoise processor/u);
	await writeFile(join(assets, 'worklet-shipped-hash.js'), 'registerProcessor("kw-ai-denoise", Processor);');
	assert.equal(await packagedDenoisingWorklet(resources), '/assets/worklet-shipped-hash.js');
	await assert.rejects(packagedDenoisingWorklet(resources, 'kw-audio-render-capture'), /exactly one kw-audio-render-capture processor/u);
	await writeFile(join(assets, 'render-capture-worklet-hash.js'), 'globalThis.registerProcessor("kw-audio-render-capture", Processor);');
	assert.equal(await packagedDenoisingWorklet(resources, 'kw-audio-render-capture'), '/assets/render-capture-worklet-hash.js');
	await writeFile(join(assets, 'worklet-stale-hash.js'), "registerProcessor('kw-ai-denoise', Processor);");
	await assert.rejects(packagedDenoisingWorklet(resources), /exactly one kw-ai-denoise processor/u);
});
