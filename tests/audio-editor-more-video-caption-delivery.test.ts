/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { createVideoSource, createLabelTrack } from '../src/common/editor/project-media-factory.ts';
import { createVideoExportPlan } from '../src/common/editor/video-export.js';
import { createEditorVideoExportAction } from '../src/common/editor/controller/export/internal/video/video-export-service.ts';
import { createFixture } from './helpers/export-service-fixture.ts';

function project(title = 'caption') {
	const source = createVideoSource({ id: 'video-source', name: 'camera.mp4', storageKey: 'media/camera.mp4',
		mimeType: 'video/mp4', contentSha256: 'ab'.repeat(32), sampleFrameCount: 144_000,
		sourceFrameCount: 90, frameRate: { num: 30, den: 1 }, width: 320, height: 180 });
	return createSoundscaperProject({ id: 'project', title: 'Original', sampleRate: 48_000, sources: [source],
		primarySequenceId: 'main', sequences: [{ id: 'main', rate: { num: 30, den: 1 }, trackIds: ['picture', 'labels'] }],
		clips: [{ kind: 'video', id: 'video-clip', sourceId: source.id, title: 'Camera', sequenceId: 'main',
			sequenceStartFrame: 0, sequenceFrameCount: 30, sourceInFrame: 0, sourceFrameCount: 30 }],
		tracks: [{ id: 'picture', type: 'video', clipIds: ['video-clip'] },
			createLabelTrack({ id: 'labels', labels: [{ id: 'cue', startFrame: 0, endFrame: 48_000, title }] })],
	});
}

test('MI06: video caption sidecar follows the filename selected for the movie', async () => {
	const { fixture, exportVideo, names } = sidecarFixture();
	const result: unknown = await exportVideo({ captions: { trackId: 'labels', mux: false, sidecar: 'srt' } });
	assert.equal(fixture.errors.length, 0, String(fixture.errors[0]));
	assert.ok(result);
	assert.deepEqual(names, ['Final.srt']);
});

function sidecarFixture(save?: () => unknown) {
	const fixture = createFixture();
	const initial = project();
	const names: unknown[] = [];
	const runtime = { ...fixture.runtime, getProject: () => initial, createVideoExportPlan,
		fileService: {
			isDesktop: true,
			getDesktopVideoExportCapabilities: async () => ({ schemaVersion: 1, formats: {
				mp4: { available: true, provider: 'external-ffmpeg' }, webm: { available: true, provider: 'external-ffmpeg' },
			} }),
			createDownload: async () => ({ url: 'blob:movie', fileName: 'Final.mp4', method: 'memory' }),
			saveFile: (request: Readonly<Record<string, unknown>>) => { names.push(request.suggestedName); return save?.() ?? { cancelled: false }; },
		},
	};
	const exportVideo = createEditorVideoExportAction(runtime, async () => { throw new Error('No audio to render'); });
	return { fixture, exportVideo, names };
}

test('MI07: burned caption wrapping preserves decomposed accented characters', () => {
	const text = `${'A'.repeat(31)}u\u0308xxxxx`;
	const plan = createVideoExportPlan(project(text), { includeAudio: false,
		canvas: { size: { width: 1_080, height: 1_920 } }, captions: { trackId: 'labels', mux: false, burnIn: true } });
	const burnIn: unknown = plan.filterPlan.burnIn;
	assert.ok(burnIn !== null && typeof burnIn === 'object' && 'cues' in burnIn && Array.isArray(burnIn.cues));
	const cue: unknown = burnIn.cues[0];
	assert.ok(cue !== null && typeof cue === 'object' && 'text' in cue && typeof cue.text === 'string');
	assert.doesNotMatch(cue.text, /\n\p{M}/u);
	assert.equal(cue.text.replaceAll('\n', ''), text);
});

test('MI08: a caption sidecar write failure retains the already published movie', async () => {
	const failure = new Error('Caption destination quota exceeded');
	const { fixture, exportVideo } = sidecarFixture(() => { throw failure; });
	const result: unknown = await exportVideo({ captions: { trackId: 'labels', mux: false, sidecar: 'srt' } });
	assert.ok(result);
	assert.strictEqual(fixture.state.exportOutput, result);
	assert.equal(fixture.state.outputUrl, 'blob:movie');
	assert.deepEqual(fixture.errors, [failure]);
	assert.equal(fixture.statuses.some(([status]) => status === 'Done'), false);
});
