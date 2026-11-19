/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createAiffBlobPcmChunkReader, inspectAiffBlobPcm } from '../src/common/editor/aiff-pcm-chunk-reader.ts';
import { createAudioEditorFileService } from '../src/common/editor/file-service.js';
import { libsndfileAiffAlignmentFixture } from './helpers/libsndfile-aiff-alignment-fixture.ts';
import { nativeOriginalImportFixture } from './helpers/native-original-import-fixture.ts';
import { createNodeWebAudioEngineFactory } from './helpers/node-web-audio-engine.ts';
import { controllerSession } from './helpers/soundscaper-controller-session.ts';

function compression(bytes: Uint8Array): string | null {
	const header = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	if (header.toString('ascii', 8, 12) === 'AIFF') return null;
	assert.equal(header.toString('ascii', 8, 12), 'AIFC');
	assert.equal(header.toString('ascii', 12, 16), 'FVER');
	assert.equal(header.toString('ascii', 24, 28), 'COMM');
	return header.toString('ascii', 50, 54);
}

test('desktop Overwrite Original retains exact libsndfile AIFF-C compression and PCM order', async context => {
	const { files, frameCount, sampleRate } = libsndfileAiffAlignmentFixture();
	let classicPcm: Float32Array | undefined;
	for (const file of files) await context.test(file.name, async subtest => {
		const native = await nativeOriginalImportFixture(file);
		subtest.after(native.close);
		const endpoints = new Set(['chooseFiles', 'releaseRead', 'releaseOriginalFile', 'prepareOriginalOverwrite',
			'releaseSaveTarget', 'beginWrite', 'writeChunk', 'patchFinalPrefix', 'finishWrite', 'abortWrite']);
		const bridge = Object.fromEntries(Object.entries(native.bridge).filter(([name]) => endpoints.has(name)));
		const fileService = createAudioEditorFileService({ bridge, fetch: native.fetch });
		const { createEngine } = createNodeWebAudioEngineFactory(subtest);
		const { controller } = await controllerSession(subtest, { fileService, engine: createEngine(), engineFactory: createEngine });
		await controller.actions.project.create({ title: 'Keep original AIFF carrier', sampleRate });
		const descriptors = await fileService.chooseFiles({ purpose: 'audio', multiple: false });
		await fileService.withReadDescriptors(descriptors, {}, async (inputs: readonly File[]) => {
			await controller.actions.project.importFiles(inputs);
		});
		const project = controller.project;
		assert.ok(project);
		assert.equal(project.sources[0]?.frameCount, frameCount);
		assert.equal(controller.actions.export.overwriteOriginalAvailable(), true);
		await controller.actions.export.overwriteOriginal();
		assert.equal(native.prepared.length, 1);
		assert.equal(native.completed.length, 1);
		const bytes = Uint8Array.from(await native.savedBytes());
		assert.equal(compression(bytes), compression(new Uint8Array(await file.arrayBuffer())));
		const output = new Blob([bytes]);
		const descriptor = await inspectAiffBlobPcm(output);
		assert.deepEqual([descriptor.frameCount, descriptor.sampleRate, descriptor.channelCount, descriptor.bitDepth],
			[frameCount, sampleRate, 1, 24]);
		const { channels: [pcm] } = await createAiffBlobPcmChunkReader(output, { descriptor }).readChunk(0);
		assert.ok(pcm?.some(sample => sample !== 0));
		if (!classicPcm) classicPcm = pcm;
		else assert.deepEqual(pcm, classicPcm);
	});
});
