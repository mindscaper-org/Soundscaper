/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import type { TestContext } from 'node:test';
import { createHash } from 'node:crypto';
import { createImportVideoFile, type ImportVideoRuntime } from '../../src/common/editor/controller/import/internal/source-import.ts';
import { createAddClipCommand, createAddSourceCommand, createAddTrackCommand } from '../../src/common/editor/commands/factories.ts';
import { bufferFromChannels, canonicalizeBuffer, writeBuffer, audioBufferChannels, type AudioBufferLike } from '../../src/common/editor/controller/source/source-audio.ts';
import { fitAudioBufferToFrames } from '../../src/common/editor/controller/import/internal/audio-buffer-frame-fit.ts';
import { inspectEncodedAudioSampleRate } from '../../src/common/editor/audio-file-metadata.js';
import { EditorProjectGeneration } from '../../src/common/editor/controller/shared/lifecycle.ts';
import { decodeBrowserContainerAudio } from '../../src/common/editor/browser-container-audio-decode.ts';
import { enableReviewedAudioImportDecoder, disableReviewedAudioImportDecoders } from '../../src/common/editor/browser-reviewed-streamed-audio-decoders.ts';
import { SOURCE_CHUNK_FRAMES } from '../../src/common/editor/source-pcm-contract.ts';
import { probeVideoTiming } from '../../src/common/editor/video-timing-probe.ts';
import { createContainerVideoTimingProbe } from '../../src/common/editor/video-timing-demux.ts';
import { reviewedVideoProjectCustody, currentReviewedVideoProject, type ReviewedVideoBytes } from './reviewed-video-project-custody.ts';
import { useLocalAudioCodecPayloads } from './reviewed-audio-codec-runtime.ts';
import { COPY } from './audio-editor-controller-harness.js';
import { ENGLISH_COPY } from '../../src/common/i18n/catalogs.js';
import { createAudioEditorFileService } from '../../src/common/editor/file-service.js';
import { createFramescaperScapeNativeRuntime } from '../../src/framescaper/editor-scape-native.ts';
import { FRAMESCAPER_PROJECT_RUNTIME_PROFILE as PROFILE } from '../../src/framescaper/editor-project-runtime-profile.ts';

/** Actual AV ingest, with picture decoding excluded and real Opus PCM produced by the shipping decoder. */
export async function reviewedAvImportCustody(context: TestContext, fixture: ReviewedVideoBytes) {
	useLocalAudioCodecPayloads(context);
	enableReviewedAudioImportDecoder('opus'); context.after(() => { disableReviewedAudioImportDecoders(); });
	assert.equal(createHash('sha256').update(fixture.bytes).digest('hex'), fixture.sha256);
	const saved: File[] = [];
	const presentation = { fileService: { ...createAudioEditorFileService(), async saveFile(request: unknown) {
		assert.ok(request && typeof request === 'object');
		const blob = Reflect.get(request, 'blob'), name = Reflect.get(request, 'suggestedName');
		assert.ok(blob instanceof Blob && typeof name === 'string');
		saved.push(new File([blob], name, { type: blob.type })); return { method: 'node-fixture', fileName: name, size: blob.size };
	} } };
	const editor = await reviewedVideoProjectCustody(context, [], { num: 30, den: 1 }, presentation);
	const generation = new EditorProjectGeneration(); generation.activate(editor.project.id);
	const decoded: { channels: Float32Array[]; sampleRate: number }[] = [];
	const allocationContext = { sampleRate: 48_000, createBuffer(channelCount: number, length: number, sampleRate: number): AudioBufferLike {
		const channels = Array.from({ length: channelCount }, () => new Float32Array(length));
		return { sampleRate, length, numberOfChannels: channelCount, getChannelData: channel => {
			const samples = channels[channel]; assert.ok(samples); return samples;
		} };
	} };
	const buffers = new Map<string, AudioBufferLike>();
	const runtime: ImportVideoRuntime = {
		SOURCE_CHUNK_FRAMES, copy: { ...ENGLISH_COPY, ...COPY }, store: editor.environment.store,
		sourceBuffers: buffers, sourcePeaks: new Map(),
		engine: { getAudioContext: async () => allocationContext, decodeAudioData: async () => {
			throw new DOMException('Native audio decoding is unavailable in Node', 'NotSupportedError');
		} },
		ffmpeg: { decode: () => { throw new Error('AV custody must use actual reviewed container decoding.'); } },
		decodeContainerAudio: async (file, options) => {
			const output = await decodeBrowserContainerAudio(file, options);
			decoded.push({ channels: output.channels.map(channel => channel.slice()), sampleRate: output.sampleRate });
			return output;
		},
		// The retained browser owns native frame decoding, preview activation and derivatives.
		createAudioEditorVideoFrameExtractor: async file => {
			const probe = await probeVideoTiming(file, { probes: [createContainerVideoTimingProbe()] });
			assert.ok(probe.decision === 'timing-asset');
			const { codedWidth: width, codedHeight: height } = probe.characteristics; assert.ok(width && height);
			return { metadata: { width, height, durationSeconds: Number(probe.timing.endTicks) / probe.timing.timescale },
				capture: () => assert.fail('Native picture decoding is retained in the browser'), dispose() {} };
		},
		scheduleDerivatives: request => { request.extractor.dispose(); request.timingLease?.release(); },
		activateVideoSource: () => assert.fail('Native picture activation is retained in the browser'),
		revokeVideoVisual: () => undefined,
		audioBufferChannels, bufferFromChannels, canonicalizeBuffer, fitAudioBufferToFrames, writeBuffer,
		inspectEncodedAudioSampleRate, createAddClipCommand, createAddSourceCommand, createAddTrackCommand,
		cacheSourceBuffer: (id, value) => { buffers.set(id, value); },
		captureProject: () => generation.capture(), assertProject: token => { generation.assertCurrent(token); assert.equal(editor.controller.project?.id, token.projectId); },
		getProject: () => currentReviewedVideoProject(editor.controller.project), projectSampleRate: () => 48_000,
		createStableId: prefix => `${prefix}-${crypto.randomUUID()}`,
		commit: command => editor.controller.actions.edit.commit(command),
		findTrack: (project, id) => project.tracks.find(track => track.id === id) ?? null,
		normalizeImportOptions: () => ({ destination: 'timeline', trackId: null, timelineStartFrame: 0 }),
		preflightStorage: async bytes => { assert.ok(Number.isSafeInteger(bytes) && bytes > 0 && bytes < 1024 ** 3); },
		stripExtension: name => name.replace(/\.[^.]+$/u, ''), warnEnvelope() {},
		audioEditorVideoThumbnailTimes: () => assert.fail('Native thumbnails are retained in the browser'),
		generateWaveformPeaks: () => assert.fail('Waveform derivatives are retained in the browser'),
		peakCacheKey: id => `peaks:${id}`,
	};
	const importVideo = createImportVideoFile(runtime);
	const result = await importVideo(new File([fixture.bytes], fixture.name, { type: fixture.mimeType }));
	assert.equal(decoded.length, 1); assert.equal(result.notice, undefined);
	return { ...editor, result, decoded: decoded[0]!, buffers, saved, async reopen() {
		await editor.controller.actions.project.flush();
		const project = currentReviewedVideoProject(editor.controller.project);
		assert.deepEqual(currentReviewedVideoProject(await editor.environment.store.loadProject(project.id)), project);
		const archive = await createFramescaperScapeNativeRuntime(PROFILE).exportScapeProject(project, editor.environment.store); assert.ok(archive.blob);
		const recipient = await reviewedVideoProjectCustody(context, [], { num: 30, den: 1 }, presentation);
		await recipient.controller.actions.project.openScapeFile(new File([archive.blob], 'AV.fscape'), () => 'copy');
		const restored = currentReviewedVideoProject(recipient.controller.project);
		assert.deepEqual(restored, project, 'the entire admitted AV document survives independent native Scape reopening');
		assert.deepEqual(currentReviewedVideoProject(await recipient.environment.store.loadProject(project.id)), project,
			'the complete restored document reaches the fresh recipient repository');
		return { ...recipient, project: restored };
	} };
}
