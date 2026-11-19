/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { encodeAiff } from '../src/common/editor/aiff.js';
import { releaseLocalAssistancePreparedAudioWave } from '../src/common/editor/controller/assistance/local-assistance-audio-spool-release.ts';
import { normalizeLocalAssistanceAudioAcceptanceAuthority } from '../src/common/editor/controller/assistance/internal/local-assistance-audio-acceptance-authority.ts';
import { transcriptGenerationTargets } from '../src/common/editor/transcript-editing.ts';
import { inspectWavBlobPcm, streamWavBlobPcm } from '../src/common/editor/wav-import.js';
import { encodeWav } from '../src/common/editor/wav.js';
import { clipboardDocument, clipboardProject } from './helpers/clipboard-source-custody.ts';
import { createNodeWebAudioEngineFactory } from './helpers/node-web-audio-engine.ts';
import { model } from './helpers/local-assistance-audio-publication-fixture.ts';
import { controllerSession } from './helpers/soundscaper-controller-session.ts';

for (const [format, projectRate, sourceRate, sourceFrames, timelineFrames, sourceStart, sourceEnd] of [
	['wav', 44_100, 48_000, 48_006, 44_106, 16_326, 39_183],
	['aifc', 44_100, 48_000, 48_006, 44_106, 16_326, 39_183],
	['aifc', 48_000, 44_100, 44_101, 48_001, 13_781, 33_075],
] as const) {
	test(`a physical ${sourceRate} Hz ${format} prepares exact model ranges in a ${projectRate} Hz project`, async context => {
		const native = createNodeWebAudioEngineFactory(context);
		const { controller } = await controllerSession(context, { engine: native.createEngine(), engineFactory: native.createEngine });
		await controller.actions.project.create({ title: 'Mixed sample rates', sampleRate: projectRate });
		const scratch = await mkdtemp(join(tmpdir(), 'goal-mixed-model-clock.'));
		context.after(async () => { await rm(scratch, { recursive: true }); });
		const frequency = 440;
		const input = Float32Array.from({ length: sourceFrames }, (_, frame) => .23 * Math.sin(2 * Math.PI * frequency * frame / sourceRate));
		const bytes = format === 'wav' ? encodeWav([input], { sampleRate: sourceRate, float: true })
			: encodeAiff([input], { sampleRate: sourceRate, sampleFormat: 'float32' });
		assert.ok(bytes instanceof Uint8Array);
		const mimeType = format === 'wav' ? 'audio/wav' : 'audio/aiff';
		const filename = `Input at its original sample rate.${format}`;
		const path = join(scratch, filename);
		await writeFile(path, bytes);
		await controller.actions.project.importFiles([new File([Uint8Array.from(await readFile(path))], filename, { type: mimeType })],
			{ destination: 'timeline' });
		const project = clipboardProject(controller.project);
		const [clip] = project.clips, [source] = project.sources;
		assert.ok(clip?.kind === 'audio' && source?.kind === 'audio');
		assert.deepEqual([project.sampleRate, clip.durationFrames, clip.sourceDurationFrames, source.sampleRate],
			[projectRate, timelineFrames, sourceFrames, sourceRate]);
		const trackId = controller.getSnapshot().selectedTrackId; assert.ok(trackId);
		controller.actions.timeline.selectClip(clip.id);
		const port = controller.selectedMediaPreparation;
		assert.deepEqual((await port.listSelectedMedia()).sources.map(item => item.sourceId), [source.id]);
		assert.deepEqual(transcriptGenerationTargets(controller.project), [{ startFrame: 0, endFrame: timelineFrames, trackId, clipId: clip.id }]);
		for (const [startFrame, endFrame, sourceStartFrame, sourceEndFrame] of [
			[0, timelineFrames, 0, sourceFrames],
			[15_000, 36_000, sourceStart, sourceEnd],
		] as const) {
			await controller.actions.timeline.setExactSelection(startFrame, endFrame, { trackIds: [trackId] });
			for (const [operation, modelRate] of [
				['voice-activity-detection', 16_000], ['source-separation', 44_100], ['speech-enhancement', 48_000],
			] as const) {
				const prepared = await port.prepareSelectedMedia({ sourceId: source.id, operation });
				const [audio] = prepared.inputs; assert.ok(audio);
				try {
					const fence = prepared.selectionFence;
					assert.deepEqual([fence.sourceStartFrame, fence.sourceEndFrame], [sourceStartFrame, sourceEndFrame]);
					const accepted = normalizeLocalAssistanceAudioAcceptanceAuthority({
						project: controller.project, source, clip, fence, startFrame, endFrame, sourceStartFrame, sourceEndFrame,
					}, 'missing mixed-clock authority');
					assert.deepEqual([accepted.sourceSampleRate, accepted.timelineStartFrame, accepted.timelineEndFrame],
						[sourceRate, startFrame, endFrame]);
					const layout = await inspectWavBlobPcm(audio.bytes);
					const frames = Math.round((endFrame - startFrame) * modelRate / projectRate);
					assert.deepEqual([layout.sampleRate, layout.frameCount, layout.channelCount], [modelRate, frames, 1]);
					let frame = 0, interiorFrames = 0, squaredError = 0;
					await streamWavBlobPcm(audio.bytes, { chunkFrames: 521,
						onChunk: (channels: Float32Array[]) => {
							for (const value of channels[0]!) {
								if (frame >= 128 && frame < frames - 128) {
									const position = (startFrame + frame * projectRate / modelRate) * sourceFrames / timelineFrames;
									const expected = .23 * Math.sin(2 * Math.PI * frequency * position / sourceRate);
									squaredError += (value - expected) ** 2;
									interiorFrames++;
								}
								frame++;
							}
						} });
					assert.equal(frame, frames);
					assert.ok(Math.sqrt(squaredError / interiorFrames) < .003,
						`${operation} audio at ${modelRate} Hz matches the chosen native samples`);
					if (startFrame && operation === 'speech-enhancement') {
						// A reviewed identity output isolates the real publication boundary from model inference.
						const sha256 = createHash('sha256').update(new Uint8Array(await audio.bytes.arrayBuffer())).digest('hex');
						assert.ok(port.acceptValidatedResult);
						const beforePublication = clipboardProject(controller.project);
						await port.acceptValidatedResult({
							sourceId: source.id, operation, selectionFence: fence, models: [model(operation)],
							outputs: [{ slotId: 'enhanced-audio', bytes: audio.bytes,
								claim: { claimVersion: 1, claimId: '1'.repeat(40), jobId: '9'.repeat(40),
									role: 'enhanced-audio', mediaType: 'audio/wav', byteLength: audio.bytes.size, sha256 },
								review: { kind: 'audio-wave', role: 'enhanced-audio', sampleRate: modelRate,
									channelCount: 1, frameCount: frames, sampleFormat: 'float32' } }],
						});
						const published = clipboardProject(controller.project);
						const derived: (typeof published.clips)[number] | undefined = published.clips.find(value => value.sourceId !== source.id);
						assert.ok(derived?.kind === 'audio');
						assert.deepEqual([derived.timelineStartFrame, derived.durationFrames, derived.sourceDurationFrames],
							[15_000, 21_000, 21_000]);
						const original = published.clips.filter(value => value.sourceId === source.id)
							.sort((left, right) => Number(left.timelineStartFrame) - Number(right.timelineStartFrame));
						assert.deepEqual(original.map(value => [value.timelineStartFrame, value.durationFrames, value.sourceStartFrame,
							value.sourceDurationFrames]),
						[[0, 15_000, 0, sourceStartFrame], [36_000, timelineFrames - 36_000, sourceEndFrame, sourceFrames - sourceEndFrame]]);
						await controller.actions.edit.undo();
						assert.deepEqual(clipboardDocument(clipboardProject(controller.project)), clipboardDocument(beforePublication));
					}
				} finally { await releaseLocalAssistancePreparedAudioWave(audio.bytes); }
			}
		}
		await controller.actions.clip.update(clip.id, { loop: { periodFrames: timelineFrames, offsetFrames: 500 } });
		assert.deepEqual((await port.listSelectedMedia()).sources, [], 'a wrapped occurrence has no contiguous source clock');
		assert.deepEqual(transcriptGenerationTargets(controller.project), []);
	});
}
