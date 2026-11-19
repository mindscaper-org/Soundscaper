/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createAiffBlobPcmChunkReader, inspectAiffBlobPcm } from '../src/common/editor/aiff-pcm-chunk-reader.ts';
import { createAudioEditorFileService } from '../src/common/editor/file-service.js';
import { inspectWavBlobPcm } from '../src/common/editor/wav-import.js';
import { createWavBlobPcmChunkReader } from '../src/common/editor/wav-pcm-chunk-reader.ts';
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

test('desktop Overwrite Original retains the AIFF-C profile and mono programme level', async context => {
	const { files, frameCount, sampleRate, samples } = libsndfileAiffAlignmentFixture();
	let classicPcm: Float32Array | undefined;
	const variants = [
		...files.map(file => ({ file, name: file.name, edit: 'none' as const })),
		{ file: files[1]!, name: 'hard-right pan and half gain', edit: 'pan' as const },
		{ file: files[2]!, name: 'authored stereo reverb', edit: 'reverb' as const },
	];
	for (const { file, name, edit } of variants) await context.test(name, async subtest => {
		const native = await nativeOriginalImportFixture(file);
		subtest.after(native.close);
		const endpoints = new Set(['chooseFiles', 'releaseRead', 'releaseOriginalFile', 'prepareOriginalOverwrite',
			'releaseSaveTarget', 'beginWrite', 'writeChunk', 'patchFinalPrefix', 'finishWrite', 'abortWrite']);
		const bridge = Object.fromEntries(Object.entries(native.bridge).filter(([name]) => endpoints.has(name)));
		const desktop = createAudioEditorFileService({ bridge, fetch: native.fetch });
		const browser = createAudioEditorFileService({ bridge: null });
		const fileService = { ...desktop, createDownload: browser.createDownload,
			prepareSave: (request: Parameters<typeof desktop.prepareSave>[0]) => (
				request && 'target' in request && request.target !== undefined
					? desktop.prepareSave(request) : browser.prepareSave(request)) };
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
		const track = project.tracks.find(item => item.type === 'audio' && item.clipIds.length);
		assert.ok(track);
		if (edit === 'pan') await controller.actions.track.update(track.id, { pan: 1, gain: .5 });
		let expected: Float32Array = edit === 'pan' ? Float32Array.from(samples, sample => sample * .5 * Math.SQRT1_2) : samples;
		if (edit === 'reverb') {
			assert.ok(controller.actions.effects.add({ scope: 'track', trackId: track.id, type: 'reverb',
				options: { params: { mix: .5, duration: .05 } } }));
			const render = async (channelMapping: 'preserve' | 'mono') => {
				const result: unknown = await controller.actions.export.start({ format: 'wav', sampleFormat: 'float32',
					includeTail: false, channelMapping, useFileSystemAccess: false });
				assert.ok(result && typeof result === 'object' && 'url' in result && typeof result.url === 'string');
				const blob = await (await fetch(result.url)).blob();
				const format = await inspectWavBlobPcm(blob);
				assert.ok(format);
				return (await createWavBlobPcmChunkReader(blob, { descriptor: format }).readChunk(0)).channels;
			};
			const [left, right] = await render('preserve');
			assert.ok(left && right && left.some((sample, frame) => Math.abs(sample - right[frame]!) > .0001));
			const [folded] = await render('mono');
			assert.ok(folded?.some((sample, frame) => Math.abs(sample - samples[frame]!) > .0001));
			expected = folded;
		}
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
		assert.ok(pcm);
		// Compare the programme interior beyond the renderer's existing boundary fades.
		const error = pcm.slice(256, -256).reduce((maximum, sample, frame) =>
			Math.max(maximum, Math.abs(sample - expected[frame + 256]!)), 0);
		assert.ok(error <= 2 ** -23, `interior PCM differs by ${String(error)}`);
		if (edit === 'none') {
			if (!classicPcm) classicPcm = pcm;
			else assert.deepEqual(pcm, classicPcm);
		}
	});
});
