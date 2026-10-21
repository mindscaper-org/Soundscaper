/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { createAudioSource, createAudioTrack, createVideoSource } from '../src/common/editor/project-media-factory.ts';
import { createEditorExportService } from '../src/common/editor/controller/export/internal/export-service.ts';
import { createVideoExportPlan } from '../src/common/editor/video-export.js';
import { createFixture, defaultPlan } from './helpers/export-service-fixture.ts';

test('MI05 extension: audio export plans and renders only the primary sequence tracks', async () => {
	const fixture = createFixture();
	const initial = createSoundscaperProject({ id: 'project', sampleRate: 48_000,
		sources: [createAudioSource({ id: 'audio-source', sampleRate: 48_000, frameCount: 6, channelCount: 2 })],
		primarySequenceId: 'main', sequences: ['main', 'other'].map(id => ({ id, rate: { num: 30, den: 1 }, trackIds: [id] })),
		clips: ['main', 'other'].map(id => ({ id: `${id}-clip`, kind: 'audio', sourceId: 'audio-source',
			timelineStartFrame: 0, sourceStartFrame: 0, sourceDurationFrames: 6, durationFrames: 6 })),
		tracks: ['main', 'other'].map(id => createAudioTrack({ id, clipIds: [`${id}-clip`] })),
	});
	const planned: unknown[] = [];
	const rendered: unknown[] = [];
	fixture.renderOptions.renderSnapshot = async (snapshot: unknown) => {
		rendered.push(snapshot);
		return { sampleRate: 48_000, length: 6, numberOfChannels: 2,
			channels: [new Float32Array(6), new Float32Array(6)] };
	};
	const runtime = { ...fixture.runtime, getProject: () => initial,
		createExportPlan: (project: Readonly<Record<string, unknown>>) => { planned.push(project.tracks); return defaultPlan(); } };
	const result: unknown = await createEditorExportService(runtime).handleExportAction('start', {});
	assert.equal(fixture.errors.length, 0, String(fixture.errors[0]));
	assert.ok(result);
	assert.equal(planned.length, 1);
	const tracks = planned[0];
	assert.ok(Array.isArray(tracks));
	assert.deepEqual(tracks.map((track: unknown) => {
		assert.ok(track !== null && typeof track === 'object' && 'id' in track);
		return track.id;
	}), ['main']);
	assert.equal(rendered.length, 1);
	const snapshot = rendered[0];
	assert.ok(snapshot !== null && typeof snapshot === 'object' && 'clips' in snapshot && Array.isArray(snapshot.clips));
	assert.deepEqual(snapshot.clips.map((clip: unknown) => {
		assert.ok(clip !== null && typeof clip === 'object' && 'id' in clip);
		return clip.id;
	}), ['main-clip']);
});

test('MI05 extension: movie export encodes only the primary sequence picture', async () => {
	const fixture = createFixture();
	const source = createVideoSource({ id: 'camera', name: 'Camera.mp4', storageKey: 'media/camera.mp4',
		mimeType: 'video/mp4', contentSha256: 'ab'.repeat(32), sampleFrameCount: 144_000,
		sourceFrameCount: 90, frameRate: { num: 30, den: 1 }, width: 320, height: 180 });
	const initial = createSoundscaperProject({ id: 'project', sampleRate: 48_000, sources: [source],
		primarySequenceId: 'main', sequences: ['main', 'other'].map(id => ({ id, rate: { num: 30, den: 1 }, trackIds: [id] })),
		clips: ['main', 'other'].map(id => ({ id: `${id}-clip`, kind: 'video', sourceId: source.id, title: id,
			sequenceId: id, sequenceStartFrame: 0, sequenceFrameCount: 30, sourceInFrame: 0, sourceFrameCount: 30 })),
		tracks: ['main', 'other'].map(id => ({ id, type: 'video', clipIds: [`${id}-clip`] })),
	});
	const clips: unknown[] = [];
	const runtime = { ...fixture.runtime, getProject: () => initial,
		createVideoExportPlan: (project: Readonly<Record<string, unknown>>, settings: Readonly<Record<string, unknown>>) => {
			clips.push(project.clips); return createVideoExportPlan(project, settings);
		},
		fileService: { isDesktop: true, getDesktopVideoExportCapabilities: async () => ({ schemaVersion: 1,
			formats: { mp4: { available: true, provider: 'external-ffmpeg' }, webm: { available: true, provider: 'external-ffmpeg' } } }),
			createDownload: async () => ({ url: 'blob:movie', fileName: 'Movie.mp4', method: 'memory' }) },
	};
	const result: unknown = await createEditorExportService(runtime).handleExportAction('start', { format: 'video-mp4' });
	assert.equal(fixture.errors.length, 0, String(fixture.errors[0]));
	assert.ok(result);
	const delivered = clips[0];
	assert.ok(Array.isArray(delivered));
	assert.deepEqual(delivered.map((clip: unknown) => {
		assert.ok(clip !== null && typeof clip === 'object' && 'id' in clip);
		return clip.id;
	}), ['main-clip']);
});
