/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveAdjacentVideoEditPoint, resolveVideoProgramGeometry } from '../src/common/editor/video-navigation-model.ts';
import { resolveProgramFrame } from '../src/common/editor/source-monitor-model.ts';
import { createSourceMonitorService } from '../src/common/editor/controller/clip-video/internal/source-monitor-service.ts';
import { EditorControllerLifetime } from '../src/common/editor/controller/shared/lifecycle.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { createVideoSource, createVideoTrack } from '../src/common/editor/project-media-factory.ts';

const RATE = { num: 25, den: 1 };
function videoClip(id: string, trackSequence = 'one') {
	return { id, kind: 'video', sourceId: `${id}-source`, sequenceId: trackSequence,
		sequenceStartFrame: 0, sequenceFrameCount: 250, sourceInFrame: 0, sourceFrameCount: 250 };
}

test('navigation scopes video solo state to the requested sequence', () => {
	const project = { sampleRate: 48_000, primarySequenceId: 'one',
		sequences: [{ id: 'one', rate: RATE, trackIds: ['v1'] }, { id: 'two', rate: RATE, trackIds: ['v2'] }],
		tracks: [{ id: 'v1', type: 'video', clipIds: ['first'] }, { id: 'v2', type: 'video', clipIds: ['other'], solo: true }],
		clips: [videoClip('first'), videoClip('other', 'two')] };
	assert.equal(resolveVideoProgramGeometry(project).programEndSequenceFrame, 250);
	assert.equal(resolveAdjacentVideoEditPoint(project, 0,
		{ sequenceId: 'one', videoTrackId: 'v1', explicit: true }, 'next'), 480_000);
});

test('hidden folder video does not extend the navigable programme', () => {
	const project = createSoundscaperProject({ id: 'folder-navigation', title: 'Pictures', now: '2026-11-17T00:00:00.000Z',
		sources: [createVideoSource({ id: 'cam', name: 'Camera', storageKey: 'camera', mimeType: 'video/mp4',
			frameCount: 480_000, sampleRate: 48_000, channelCount: 2, frameRate: RATE, width: 1920, height: 1080 })],
		clips: [{ ...videoClip('first', 'seq'), sourceId: 'cam', title: 'Picture' }],
		tracks: [createVideoTrack({ id: 'v1', name: 'Video', clipIds: ['first'] })],
		trackFolders: [{ id: 'pictures', name: 'Pictures', hidden: true }],
		sequences: [{ id: 'seq', name: 'Sequence', rate: RATE, trackNodes: [
			{ kind: 'folder', id: 'pictures', parentFolderId: null },
			{ kind: 'track', id: 'v1', parentFolderId: 'pictures' },
		] }], primarySequenceId: 'seq' });
	assert.equal(resolveVideoProgramGeometry(project).programEndSample, 0);
	assert.equal(resolveAdjacentVideoEditPoint(project, 0,
		{ sequenceId: 'seq', videoTrackId: null, explicit: false }, 'next'), null);
});

test('untargeted match-frame skips hidden and non-soloed video lanes', () => {
	for (const state of [{ hidden: true }, {}]) {
		const project = { sampleRate: 48_000, primarySequenceId: 'one',
			sequences: [{ id: 'one', rate: RATE, trackIds: ['first-track', 'visible-track'] }],
			tracks: [{ id: 'first-track', type: 'video', clipIds: ['first'], ...state },
				{ id: 'visible-track', type: 'video', clipIds: ['visible'], solo: !('hidden' in state) }],
			clips: [videoClip('first'), videoClip('visible')], sources: [] };
		assert.equal(resolveProgramFrame(project, { sample: 48_000 })?.sourceId, 'visible-source');
	}
});

test('source monitor retires marks across copied project sessions', () => {
	let project = { id: 'project-a', sources: [{ id: 'shared-source', kind: 'video', name: 'Camera',
		frameRate: RATE, sourceFrameCount: 250 }],
		projectBin: { clips: [{ id: 'bin', kind: 'video', binItemId: 'item', sourceId: 'shared-source' }] } };
	const monitor = createSourceMonitorService({ lifetime: new EditorControllerLifetime(),
		getProject: () => project, publishProjectState() {} });
	monitor.open('item'); monitor.seek(150); monitor.markIn(); monitor.markOut(179);
	project = { ...project, id: 'project-b' };
	assert.equal(monitor.view().sourceId, null);
	assert.equal(monitor.points('item', 1), null);
	monitor.open('item');
	assert.equal(monitor.view().positionFrame, 0);
	assert.equal(monitor.view().markIn, null);
});
