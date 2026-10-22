/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createEditorExportService } from '../src/common/editor/controller/export/internal/export-service.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { createAudioSource, createAudioTrack, createVideoSource } from '../src/common/editor/project-media-factory.ts';
import { createVideoExportPlan } from '../src/common/editor/video-export.js';
import { createFixture } from './helpers/export-service-fixture.ts';

for (const media of ['audio', 'video'] as const) {
	for (const replacement of ['cancelled', 'failed'] as const) {
		test(`MI19: ${media} ${replacement} replacement preserves the prior downloadable file`, async context => {
			const fixture = outputFixture(media, replacement);
			context.after(() => { URL.revokeObjectURL(fixture.previous.url); });
			await fixture.exporting();
			assert.strictEqual(fixture.base.state.exportOutput, fixture.previous);
			assert.equal(fixture.base.state.outputUrl, fixture.previous.url);
			assert.equal(fixture.cleaned(), 0);
			assert.equal(await (await fetch(fixture.previous.url)).text(), 'previous successful file');
		});
	}
	test(`MI19: successful ${media} replacement retires the previous file after publication`, async context => {
		const fixture = outputFixture(media, 'saved');
		context.after(() => { URL.revokeObjectURL(fixture.previous.url); });
		const result: unknown = await fixture.exporting();
		assert.ok(result);
		assert.deepEqual(fixture.events, ['saved', 'old-cleanup']);
		assert.equal(fixture.cleaned(), 1);
		assert.notStrictEqual(fixture.base.state.exportOutput, fixture.previous);
	});
	test(`MI19: ${media} prior-file cleanup failure retains the newly saved output`, async context => {
		const failure = new Error('prior temporary file cleanup failed');
		const fixture = outputFixture(media, 'saved', failure);
		context.after(() => { URL.revokeObjectURL(fixture.previous.url); });
		const result: unknown = await fixture.exporting();
		assert.ok(result);
		assert.strictEqual(fixture.base.state.exportOutput, result);
		assert.deepEqual(fixture.events, ['saved', 'old-cleanup']);
		assert.deepEqual(fixture.base.errors, [failure]);
		assert.equal(fixture.base.statuses.some(([message]) => message === 'Done'), false);
	});
}

function outputFixture(media: 'audio' | 'video', replacement: 'cancelled' | 'failed' | 'saved', cleanupFailure?: Error) {
	const base = createFixture();
	const events: string[] = [];
	let cleanups = 0;
	const previous = { url: URL.createObjectURL(new Blob(['previous successful file'])), fileName: 'Previous.wav' };
	base.state.exportOutput = previous; base.state.outputUrl = previous.url;
	base.state.outputCleanup = async () => { cleanups++; events.push('old-cleanup'); if (cleanupFailure) throw cleanupFailure; };
	const audio = createAudioSource({ id: 'audio-source', sampleRate: 48_000, frameCount: 6, channelCount: 2 });
	const video = createVideoSource({ id: 'camera', storageKey: 'camera.mp4', sampleFrameCount: 48_000,
		sourceFrameCount: 30, contentSha256: 'ab'.repeat(32), frameRate: { num: 30, den: 1 }, width: 320, height: 180 });
	const project = createSoundscaperProject({ id: 'replacement', sampleRate: 48_000, primarySequenceId: 'main',
		sequences: [{ id: 'main', rate: { num: 30, den: 1 }, trackIds: ['track'] }],
		sources: media === 'audio' ? [audio] : [video],
		tracks: media === 'audio' ? [createAudioTrack({ id: 'track', clipIds: ['clip'] })] : [{ id: 'track', type: 'video', clipIds: ['clip'] }],
		clips: media === 'audio' ? [{ kind: 'audio', id: 'clip', sourceId: audio.id, timelineStartFrame: 0,
			sourceStartFrame: 0, durationFrames: 6, sourceDurationFrames: 6 }]
			: [{ kind: 'video', id: 'clip', sourceId: video.id, sequenceId: 'main', sequenceStartFrame: 0,
				sequenceFrameCount: 30, sourceInFrame: 0, sourceFrameCount: 30 }],
	});
	const service = createEditorExportService({ ...base.runtime, getProject: () => project, createVideoExportPlan,
		fileService: { ...base.runtime.fileService, isDesktop: true,
			getDesktopVideoExportCapabilities: async () => ({ schemaVersion: 1, formats: {
				mp4: { available: true, provider: 'external-ffmpeg' }, webm: { available: true, provider: 'external-ffmpeg' } } }),
			saveFile: async () => {
				if (replacement === 'failed') throw new Error('replacement destination write failed');
				if (replacement === 'cancelled') return { cancelled: true };
				events.push('saved'); return { fileName: 'Replacement', method: 'desktop' };
			},
		},
	});
	return { base, previous, events, cleaned: () => cleanups,
		exporting: () => service.handleExportAction('start', { format: media === 'video' ? 'video-mp4' : 'wav', saveToFile: true }) };
}
