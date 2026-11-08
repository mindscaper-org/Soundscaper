/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createMacroCommandService } from '../src/common/editor/controller/effects/internal/macro/macro-command-service.ts';
import { createSelectionViewService, type SelectionViewState } from '../src/common/editor/controller/track-audio/internal/selection-view-service.ts';
import { parseAudacityEffectMacro } from '../src/common/editor/effect-macros.js';
import { isMacroCommandStep } from '../src/common/editor/macro-command-steps.ts';
import { createAudioClip, createAudioSource, createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { projectForRuntimeConsumers } from '../src/common/editor/project-current-runtime.ts';
import { editorTimelineDurationFrames, projectDurationFrames } from '../src/common/editor/project.js';
import { createSoundscaperProject, validateSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { applySoundscaperProjectCommand } from '../src/soundscaper/editor-project-commands.ts';
import type { SelectionViewCommand } from '../src/common/editor/controller/track-audio/internal/selection-view-service-types.d.ts';

test('a fully specified native time selection retains its positive extent beyond the visible editor span', () => {
	const fixture = selectionFixture(); fixture.run('SelectTime:Start="100" End="101" RelativeTo="ProjectStart"');
	assert.deepEqual(fixture.range(), [4_800_000, 4_848_000]);
	assert.deepEqual(fixture.selection().trackIds, ['track']);
	assert.deepEqual(fixture.selection().frequencyRange, { minimumFrequency: 100, maximumFrequency: 400 });
	assert.deepEqual(fixture.selection().clipIds, []);
	assert.equal(fixture.state.selectedClipId, null);
	assert.ok(validateSoundscaperProject(fixture.project()));
});

for (const field of ['Start', 'End']) test(`partial native ${field} keeps its native zero counterpart beyond the view cap`, () => {
	const fixture = selectionFixture(); fixture.run(`SelectTime:${field}="100"`);
	assert.deepEqual(fixture.range(), [0, 4_800_000]);
});

test('relative native time arithmetic may extend a selection beyond the visible editor span', () => {
	const fixture = selectionFixture(); fixture.run('SelectTime:Start="100" End="101" RelativeTo="SelectionStart"');
	assert.deepEqual(fixture.range(), [4_804_800, 4_852_800]);
});

for (const command of ['SelectNone', 'NewMonoTrack', 'SelAllTracks', 'SelectTracks:Track="0" TrackCount="1" Mode="Set"']) {
	test(`native ${command} preserves an already admitted extent beyond the view cap`, () => {
		const fixture = selectionFixture(); fixture.run('SelectTime:Start="100" End="101"');
		fixture.run(command.includes(':') ? command : `${command}:`);
		assert.deepEqual(fixture.range(), command === 'SelectNone' ? [4_800_000, 4_800_000] : [4_800_000, 4_848_000]);
	});
}

test('ordinary local exact selection still clamps to its current editor span', () => {
	const fixture = selectionFixture(); fixture.service.setExactSelection(4_800_000, 4_848_000);
	assert.deepEqual(fixture.range(), [1_440_000, 1_440_000]);
});

test('ordinary local negative selection retains its existing clamping behavior', () => {
	const fixture = selectionFixture(); fixture.service.setExactSelection(-4800, 9600);
	assert.deepEqual(fixture.range(), [0, 9600]);
});

test('an ordinary native time range inside the view keeps its exact frame coordinates', () => {
	const fixture = selectionFixture(); fixture.run('SelectTime:Start="0.1" End="0.2"');
	assert.deepEqual(fixture.range(), [4800, 9600]);
});

for (const line of ['SelectTime:Start="-1" End="1"', 'SelectTime:Start="1000000000000" End="1000000000001"']) {
	test(`unrepresentable native time selection refuses before changing any selection: ${line}`, () => {
		const fixture = selectionFixture(), original = fixture.project();
		assert.throws(() => fixture.run(line), RangeError);
		assert.equal(fixture.project(), original);
	});
}

test('native direct-port nonfinite endpoints refuse without mutating the project', () => {
	const fixture = selectionFixture(), original = fixture.project();
	assert.throws(() => fixture.service.setExactSelection(Infinity, 9600, {}, { nativeTime: true }), RangeError);
	assert.equal(fixture.project(), original);
});

function selectionFixture() {
	let project = createSoundscaperProject({ id: 'native-selection-extent', sampleRate: 48_000,
		sources: [createAudioSource({ id: 'source', storageKey: 'source', sampleRate: 48_000, channelCount: 1, frameCount: 48_000 })],
		tracks: [createAudioTrack({ id: 'track', clipIds: ['clip'] })],
		clips: [createAudioClip({ id: 'clip', sourceId: 'source', timelineStartFrame: 0, durationFrames: 48_000 })],
		selection: { startFrame: 4800, endFrame: 9600, trackIds: ['track'], clipIds: [], frequencyRange: { minimumFrequency: 100, maximumFrequency: 400 } },
	});
	assert.ok(validateSoundscaperProject(project));
	const view = () => {
		const value = projectForRuntimeConsumers({ ...project });
		assert.ok(value.selection);
		return { ...value, tracks: value.tracks.map(track => ({ ...track })), clips: value.clips.map(clip => ({ ...clip })),
			selection: { ...value.selection } };
	};
	const apply = (command: SelectionViewCommand) => { project = applySoundscaperProjectCommand(project, command); return view(); };
	const state: SelectionViewState = { selectedTrackId: 'track', selectedClipId: 'clip', selectedAnnotationId: null,
		analysisProcessing: false, showRms: false, showVerticalRulers: false, scrollViewToPlayhead: true, pinnedPlayhead: false,
		playbackOnRulerClick: true, timelineViewportWidth: 1000, pixelsPerSecond: 100,
	};
	const service = createSelectionViewService({ state, getProject: view, activeSelection: () => view().selection,
		DEFAULT_PIXELS_PER_SECOND: 100, MAX_PIXELS_PER_SECOND: 10_000,
		copy: { audioTrackNotFound: 'Track not found.', audioClipNotFound: 'Clip not found.', selectionFramesFinite: 'Selection frames must be finite.',
			timelineFramesFinite: 'Timeline frames must be finite.', v2Required: 'Project required.', zeroCrossingsAligned: 'Aligned.' },
		engine: { getPositionFrames: () => 0, getState: () => ({ state: 'stopped' }), seek() {} },
		projectSampleRate: () => 48_000, projectDurationFrames, editorTimelineDurationFrames,
		findClip: (value, id) => value.clips.find(clip => clip.id === id),
		findClipTrack: (value, id) => value.tracks.find(track => Array.isArray(track.clipIds) && track.clipIds.includes(id)),
		findTrack: (value, id) => value.tracks.find(track => track.id === id), collectRelatedClipIds: (_value, ids) => ids,
		normalizeTimelineFrame: value => Math.max(0, Math.min(1_440_000, Math.round(Number(value)))),
		snapAudioEditorFrameWithProject: Number, commit: apply, updateSelection: apply,
		cloneProject: value => structuredClone(value), audioBufferChannels: () => [new Float32Array(1)],
		renderSnapshot: () => ({ channels: [new Float32Array(1)] }), findNearestAudioZeroCrossing: (_channels, frame) => frame,
		handleError: error => { throw error; }, persistSetting() {}, productSettingKey: key => key, setStatus() {},
		publishDocumentSnapshot() {}, publishProjectState() {}, resetRoutedInputMeter() {}, updatePlayhead() {},
		synchronizeAutomaticSampleEditMode() {}, synchronizeMicrophoneMeterTarget() {},
	});
	const macro = createMacroCommandService({ getProject: view, projectSampleRate: () => 48_000,
		timelineDurationFrames: () => 48_000, setExactSelection: service.setExactSelection,
		getActions: () => ({ timeline: { selectAllTracks: service.selectAllTracks, selectNoTracks: service.clipNavigation.selectNoTracks,
			clearSelection: () => assert.fail('Native SelectNone must preserve its own time origin.'),
		}, track: { addMono: () => {
			project = applySoundscaperProjectCommand(project, { type: 'track/add', track: createAudioTrack({ id: 'created', clipIds: [] }) });
			assert.ok(validateSoundscaperProject(project)); return 'created';
		} } }),
	});
	return { service, state, project: () => project, selection: () => view().selection,
		range: () => [view().selection.startFrame, view().selection.endFrame],
		run(line: string) {
			const step = parseAudacityEffectMacro(`${line}\n`).effects[0];
			assert.ok(isMacroCommandStep(step)); macro.runMacroCommand(step);
		},
	};
}
