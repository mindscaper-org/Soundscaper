/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createMacroCommandService } from '../src/common/editor/controller/effects/internal/macro/macro-command-service.ts';
import { createTrackStructuralOperationService } from '../src/common/editor/controller/track-audio/internal/track-structural-operation-service.ts';
import { planTrackSort } from '../src/common/editor/controller/track-audio/internal/track-structural-operation-planner.ts';
import { createMacroCommandStep } from '../src/common/editor/macro-command-steps.ts';
import { parseAudacityShortcutImport } from '../src/common/editor/audacity-shortcut-import.ts';
import { applyEditorCommand } from '../src/common/editor/commands.js';
import { createAudioEditorProjectV17, validateAudioEditorProjectV17 } from '../src/common/editor/project-v17.ts';
import { createAudioClip, createAudioSource, createAudioTrack, createLabelTrack } from '../src/common/editor/project-media-factory.ts';
import { createTakeFitProject } from './helpers/take-fit-project.ts';

test('an imported native SortByTime keeps an empty wave lane at zero before delayed audio', () => {
	const fixture = sortFixture(); fixture.runNative();
	assert.deepEqual(fixture.names(), ['Empty', 'Voice']);
});

test('ordinary local sorting keeps its existing empty-last order', () => {
	const fixture = sortFixture(); fixture.runLocal();
	assert.deepEqual(fixture.names(), ['Voice', 'Empty']);
});

test('native sorting also treats an empty label track as origin zero', () => {
	const fixture = sortFixture(true); fixture.runNative();
	assert.deepEqual(fixture.names(), ['Empty', 'Voice']);
});

test('populated native tracks still sort by their actual content positions', () => {
	const original = sortProject();
	const project = createAudioEditorProjectV17({ sampleRate: original.sampleRate, sources: original.sources,
		tracks: [createAudioTrack({ id: 'later', name: 'Later', clipIds: ['later-clip'] }, 8000), ...original.tracks.filter(track => track.id !== 'empty')],
		clips: [createAudioClip({ id: 'later-clip', sourceId: 'source', timelineStartFrame: 6000, durationFrames: 1000 }), ...original.clips],
	});
	const commands = planTrackSort(projectView(project), 'time', { nativeSort: true });
	const sorted = commands.reduce((value, command) => applyEditorCommand(value, command), project);
	assert.deepEqual(sorted.tracks.map(track => track.name), ['Voice', 'Later']);
});

test('take-only tracks retain their recorded start rather than looking empty', () => {
	const original = createTakeFitProject();
	const project = createAudioEditorProjectV17({ sampleRate: original.sampleRate, sources: original.sources, clips: [], takeGroups: original.takeGroups,
		tracks: [...original.tracks.map(track => ({ ...track, clipIds: [] })), createAudioTrack({ id: 'empty', name: 'Empty' })],
		sequences: [{ id: original.primarySequenceId, trackIds: ['track', 'empty'] }], primarySequenceId: original.primarySequenceId,
	});
	assert.ok(validateAudioEditorProjectV17(project));
	const commands = planTrackSort(projectView(project), 'time', { nativeSort: true });
	const sorted = commands.reduce((value, command) => applyEditorCommand(value, command), project);
	assert.deepEqual(sorted.tracks.map(track => track.id), ['empty', 'track']);
});

test('native sort propagates an owning lock refusal without publishing a partial order', () => {
	const fixture = sortFixture(false, true);
	assert.throws(() => fixture.runNative(), /locked track/iu);
	assert.deepEqual(fixture.names(), ['Voice', 'Empty']);
});

test('legacy SortByTime shortcut refuses the local empty-last ordering', () => {
	const plan = parseAudacityShortcutImport('<audacitykeyboard><command name="SortByTime" key="Ctrl+Alt+Shift+F7"/></audacitykeyboard>',
		{ 'sort-by-time': [] }, { availableActionIds: ['sort-by-time'] });
	assert.equal(plan.importedCount, 0);
	assert.deepEqual(plan.skipped, [{ command: 'SortByTime', reason: 'unsupported-command' }]);
});

test('modern sort-by-time shortcuts retain the ordinary local action', () => {
	const plan = parseAudacityShortcutImport('<Shortcuts><SC><key>sort-by-time</key><seq>Ctrl+Alt+Shift+F7</seq></SC></Shortcuts>',
		{ 'sort-by-time': [] }, { availableActionIds: ['sort-by-time'] });
	assert.equal(plan.importedCount, 1);
	assert.deepEqual(plan.shortcuts['sort-by-time'], ['Ctrl+Alt+Shift+F7']);
	assert.deepEqual(plan.skipped, []);
});

function sortProject(label = false) {
	return createAudioEditorProjectV17({ sampleRate: 8000,
		sources: [createAudioSource({ id: 'source', storageKey: 'source', sampleRate: 8000, channelCount: 1, frameCount: 8000 })],
		clips: [createAudioClip({ id: 'clip', sourceId: 'source', timelineStartFrame: 2000, durationFrames: 4000 })],
		tracks: [createAudioTrack({ id: 'voice', name: 'Voice', clipIds: ['clip'] }, 8000),
			label ? createLabelTrack({ id: 'empty', name: 'Empty' }) : createAudioTrack({ id: 'empty', name: 'Empty' }, 8000)],
	});
}

function projectView(project: ReturnType<typeof sortProject>) {
	return { ...project, tracks: project.tracks.map(track => ({ ...track })), sources: project.sources.map(source => ({ ...source })),
		clips: project.clips.map(clip => {
			if (typeof clip.durationFrames !== 'number' || typeof clip.timelineStartFrame !== 'number') assert.fail('The fixture requires sample-anchored clips.');
			return { ...clip, durationFrames: clip.durationFrames, timelineStartFrame: clip.timelineStartFrame };
		}),
	};
}

function sortFixture(label = false, locked = false) {
	let project = sortProject(label);
	if (locked) project = applyEditorCommand(project, { type: 'track/update', trackId: 'empty', changes: { locked: true } });
	assert.ok(validateAudioEditorProjectV17(project));
	const service = createTrackStructuralOperationService({ getProject: () => projectView(project), getSelectedTrackId: () => null,
		editingBlocked: () => false, getPositionFrames: () => 0, lifetime: { assertActive() {} },
		commit: command => { project = applyEditorCommand(project, command); },
	});
	const macro = createMacroCommandService({ getProject: () => projectView(project), projectSampleRate: () => 8000,
		timelineDurationFrames: () => 6000, setExactSelection: () => undefined, getActions: () => ({ track: service }),
	});
	return { runNative: () => macro.runMacroCommand(createMacroCommandStep('SortByTime')),
		runLocal: () => service.sortByTime(), names: () => project.tracks.map(track => track.name) };
}
