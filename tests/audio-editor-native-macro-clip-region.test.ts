/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createMacroCommandService } from '../src/common/editor/controller/effects/internal/macro/macro-command-service.ts';
import { createClipSelectionNavigationService, type ClipSelectionNavigationState } from '../src/common/editor/controller/track-audio/internal/clip-selection-navigation-service.ts';
import { createAudioEditorProjectV17, validateAudioEditorProjectV17 } from '../src/common/editor/project-v17.ts';
import { createAudioSource, createAudioClip, createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { createMacroCommandStep } from '../src/common/editor/macro-command-steps.ts';
import { audacityShortcutImportCommand } from '../src/common/editor/audacity-shortcut-import-commands.ts';

test('native next clip retains selected track scope, focus and spectral range', () => {
	const fixture = clipFixture([6400, 4800]);
	fixture.run('SelNextClip');
	assert.deepEqual(fixture.selection(), { startFrame: 0, endFrame: 4800, trackIds: ['track-0', 'track-1'], clipIds: [], annotationIds: [],
		frequencyRange: { minimumFrequency: 100, maximumFrequency: 1000 } });
	assert.equal(fixture.state.selectedTrackId, 'track-1');
	assert.equal(fixture.state.selectedClipId, null);
});

test('native previous clip resolves aligned-track ties by maximum end', () => {
	const fixture = clipFixture([4800, 6400], { startFrame: 8000, endFrame: 8000 });
	fixture.run('SelPrevClip');
	assert.equal(fixture.selection().startFrame, 0); assert.equal(fixture.selection().endFrame, 6400);
});

test('native navigation searches selected tracks before its all-audio fallback', () => {
	for (const trackIds of [['track-0'], []]) {
		const fixture = clipFixture([6400, 4800], { trackIds });
		fixture.run('SelNextClip');
		assert.equal(fixture.selection().endFrame, trackIds.length ? 6400 : 4800);
		assert.deepEqual(fixture.selection().trackIds, trackIds);
	}
});

test('ordinary local next-clip selection keeps its existing full-clip behavior', () => {
	const fixture = clipFixture([6400, 4800]);
	fixture.navigation.selectNextClip();
	assert.equal(fixture.selection().endFrame, 6400);
	assert.deepEqual(fixture.selection().trackIds, ['track-0']);
	assert.equal(fixture.selection().frequencyRange, null);
});

test('native no-result navigation retains the original selection', () => {
	const fixture = clipFixture([6400], { startFrame: 16000, endFrame: 16000 });
	const before = structuredClone(fixture.selection());
	assert.equal(fixture.run('SelNextClip'), null);
	assert.deepEqual(fixture.selection(), before);
});

test('legacy native clip-navigation aliases refuse changed local selection semantics', () => {
	for (const [native, modern] of [['SelNextClip', 'sel-next-clip'], ['SelPrevClip', 'sel-prev-clip']] as const) {
		assert.equal(audacityShortcutImportCommand(native, true), null);
		assert.ok(audacityShortcutImportCommand(modern, false));
	}
});

function clipFixture(durations: readonly number[], overrides: Readonly<{ startFrame?: number; endFrame?: number; trackIds?: readonly string[] }> = {}) {
	const tracks = durations.map((_, index) => createAudioTrack({ id: `track-${index}`, clipIds: [`clip-${index}`] }, 8000));
	let project = createAudioEditorProjectV17({ sampleRate: 8000,
		sources: [createAudioSource({ id: 'source', storageKey: 'source', sampleRate: 8000, channelCount: 1, frameCount: 32000 })], tracks,
		clips: durations.map((durationFrames, index) => createAudioClip({ id: `clip-${index}`, sourceId: 'source', durationFrames })),
		selection: { startFrame: 0, endFrame: 0, trackIds: tracks.map(track => track.id), clipIds: [],
			frequencyRange: { minimumFrequency: 100, maximumFrequency: 1000 }, ...overrides },
	});
	assert.ok(validateAudioEditorProjectV17(project));
	const view = () => ({ schemaVersion: project.schemaVersion, sampleRate: project.sampleRate,
		clips: project.clips.map(clip => ({ ...clip })), tracks: project.tracks.map(track => ({ ...track })), selection: project.selection });
	const state: ClipSelectionNavigationState = { selectedTrackId: tracks.at(-1)?.id ?? null, selectedClipId: null, selectedAnnotationId: null };
	const publish = (selection: Readonly<Record<string, unknown>>) => {
		project = createAudioEditorProjectV17({ ...project, selection }); return project;
	};
	const navigation = createClipSelectionNavigationService({ state, getProject: view,
		updateSelection: command => publish({ ...command }), seek: () => undefined });
	const service = createMacroCommandService({ getProject: view, getSelectedTrackId: () => state.selectedTrackId,
		projectSampleRate: () => 8000, timelineDurationFrames: () => 32000,
		setExactSelection: (startFrame, endFrame, details) => publish({ ...project.selection, ...details, startFrame, endFrame }),
		getActions: () => ({ timeline: { selectNextClip: navigation.selectNextClip, selectPreviousClip: navigation.selectPreviousClip } }),
	});
	return { state, navigation, run: (command: string) => service.runMacroCommand(createMacroCommandStep(command)), selection: () => project.selection };
}
