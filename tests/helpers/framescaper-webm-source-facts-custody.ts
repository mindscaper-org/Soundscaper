/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import type { TestContext } from 'node:test';
import { createImportVideoFile, type ImportVideoRuntime } from '../../src/common/editor/controller/import/internal/source-import.ts';
import { createAddClipCommand, createAddSourceCommand, createAddTrackCommand } from '../../src/common/editor/commands/factories.ts';
import { bufferFromChannels, canonicalizeBuffer, writeBuffer, audioBufferChannels } from '../../src/common/editor/controller/source/source-audio.ts';
import { fitAudioBufferToFrames } from '../../src/common/editor/controller/import/internal/audio-buffer-frame-fit.ts';
import { inspectEncodedAudioSampleRate } from '../../src/common/editor/audio-file-metadata.js';
import { EditorProjectGeneration } from '../../src/common/editor/controller/shared/lifecycle.ts';
import { SOURCE_CHUNK_FRAMES } from '../../src/common/editor/source-pcm-contract.ts';
import { readContainerVideoSourceCharacteristics } from '../../src/common/editor/video-container-characteristics.ts';
import { ENGLISH_COPY } from '../../src/common/i18n/catalogs.js';
import { reviewedVideoProjectCustody, currentReviewedVideoProject } from './reviewed-video-project-custody.ts';
import { COPY } from './audio-editor-controller-harness.js';

/** Real Bin import/publication; native picture capture and all audio allocation remain unavailable. */
export async function webmSourceFactsCustody(context: TestContext, destination: 'project-bin' | 'timeline' = 'project-bin') {
	const editor = await reviewedVideoProjectCustody(context, [], { num: 30, den: 1 });
	const generation = new EditorProjectGeneration(); generation.activate(editor.project.id);
	const nativeCalls: string[] = [];
	const unavailable = (operation: string): never => { nativeCalls.push(operation); return assert.fail(`Native ${operation} stays in the browser witness.`); };
	const runtime: ImportVideoRuntime = {
		SOURCE_CHUNK_FRAMES, copy: { ...ENGLISH_COPY, ...COPY }, store: editor.environment.store,
		sourceBuffers: new Map(), sourcePeaks: new Map(),
		engine: {
			getAudioContext: async () => ({ sampleRate: 48_000, createBuffer: () => unavailable('audio allocation') }),
			decodeAudioData: async () => unavailable('audio decode'),
		},
		ffmpeg: { decode: () => unavailable('FFmpeg audio decode') },
		decodeContainerAudio: async () => unavailable('container audio decode'),
		createAudioEditorVideoFrameExtractor: async (file, options) => {
			const facts = await readContainerVideoSourceCharacteristics(file);
			const timing = options?.timing;
			assert.ok(timing && facts.codedWidth && facts.codedHeight);
			return { metadata: { width: facts.codedWidth, height: facts.codedHeight,
				durationSeconds: Number(timing.endTicks) / timing.timescale },
				capture: () => unavailable('picture capture'), dispose() {} };
		},
		scheduleDerivatives: request => { request.extractor.dispose(); request.timingLease?.release(); },
		activateVideoSource: () => unavailable('picture activation'), revokeVideoVisual() {},
		audioBufferChannels, bufferFromChannels, canonicalizeBuffer, fitAudioBufferToFrames, writeBuffer,
		inspectEncodedAudioSampleRate, createAddClipCommand, createAddSourceCommand, createAddTrackCommand,
		cacheSourceBuffer: () => unavailable('audio buffer cache'),
		captureProject: () => generation.capture(),
		assertProject: token => { generation.assertCurrent(token); assert.equal(editor.controller.project?.id, token.projectId); },
		getProject: () => currentReviewedVideoProject(editor.controller.project), projectSampleRate: () => 48_000,
		createStableId: prefix => `${prefix}-${crypto.randomUUID()}`,
		commit: command => editor.controller.actions.edit.commit(command),
		findTrack: (project, id) => project.tracks.find(track => track.id === id) ?? null,
		normalizeImportOptions: () => ({ destination, trackId: null, timelineStartFrame: 0 }),
		preflightStorage: async bytes => { assert.ok(Number.isSafeInteger(bytes) && bytes > 0 && bytes < 1024 ** 3); },
		stripExtension: name => name.replace(/\.[^.]+$/u, ''), warnEnvelope() {},
		audioEditorVideoThumbnailTimes: () => unavailable('thumbnail extraction'),
		generateWaveformPeaks: async () => unavailable('waveform derivation'), peakCacheKey: id => `peaks:${id}`,
	};
	return { ...editor, nativeCalls, importVideo: createImportVideoFile(runtime) };
}
