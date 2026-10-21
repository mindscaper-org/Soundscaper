/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createEditorVideoExportAction } from '../src/common/editor/controller/export/internal/video/video-export-service.ts';
import { createAudioSource, createAudioTrack, createVideoSource } from '../src/common/editor/project-media-factory.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { createVideoExportPlan } from '../src/common/editor/video-export.js';
import { createFixture } from './helpers/export-service-fixture.ts';

test('MW006 extension: the actual movie export controller honors the imported picture-only delivery choice', async () => {
	const camera = createVideoSource({ id: 'camera', name: 'Camera.mp4', storageKey: 'camera.mp4',
		contentSha256: 'ab'.repeat(32), sampleFrameCount: 48_000, sourceFrameCount: 30,
		frameRate: { num: 30, den: 1 }, width: 320, height: 180 });
	const audio = createAudioSource({ id: 'audio-source', sampleRate: 48_000, frameCount: 48_000, channelCount: 2 });
	const project = createSoundscaperProject({ id: 'picture-only', sampleRate: 48_000,
		sources: [camera, audio], primarySequenceId: 'main',
		sequences: [{ id: 'main', rate: { num: 30, den: 1 }, trackIds: ['picture', 'audio'] }],
		tracks: [{ id: 'picture', type: 'video', clipIds: ['video-clip'] }, createAudioTrack({ id: 'audio', clipIds: ['audio-clip'] })],
		clips: [{ kind: 'video', id: 'video-clip', sourceId: camera.id, sequenceId: 'main',
			sequenceStartFrame: 0, sequenceFrameCount: 30, sourceInFrame: 0, sourceFrameCount: 30 },
		{ kind: 'audio', id: 'audio-clip', sourceId: audio.id, timelineStartFrame: 0, sourceStartFrame: 0,
			sourceDurationFrames: 48_000, durationFrames: 48_000 }],
	});
	const fixture = createFixture();
	let rendered = 0;
	let audioInputs = -1;
	const exporting = createEditorVideoExportAction({ ...fixture.runtime, getProject: () => project,
		createVideoExportPlan: (value: Readonly<Record<string, unknown>>, settings: Readonly<Record<string, unknown>>) => {
			const plan = createVideoExportPlan(value, settings);
			audioInputs = plan.inputs.filter((input: { readonly kind: string }) => input.kind === 'staged-audio-mix').length;
			return plan;
		},
		fileService: { isDesktop: true, getDesktopVideoExportCapabilities: async () => ({ schemaVersion: 1,
			formats: { mp4: { available: true, provider: 'external-ffmpeg' }, webm: { available: true, provider: 'external-ffmpeg' } } }),
			createDownload: async () => ({ url: 'blob:movie', fileName: 'Picture.mp4', method: 'memory' }) },
	}, async () => { rendered++; throw new Error('The picture-only choice must not render an audio mix.'); });
	const result: unknown = await exporting({ includeAudio: false });
	assert.deepEqual(fixture.errors, []);
	assert.ok(result);
	assert.equal(audioInputs, 0);
	assert.equal(rendered, 0);
	assert.ok(fixture.calls.includes('video-audio:false'));
});
