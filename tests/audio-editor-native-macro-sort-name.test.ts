/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createMacroCommandService } from '../src/common/editor/controller/effects/internal/macro/macro-command-service.ts';
import { createTrackStructuralOperationService } from '../src/common/editor/controller/track-audio/internal/track-structural-operation-service.ts';
import { createMacroCommandStep } from '../src/common/editor/macro-command-steps.ts';
import { parseAudacityShortcutImport } from '../src/common/editor/audacity-shortcut-import.ts';
import { applyEditorCommand } from '../src/common/editor/commands.js';
import { createAudioEditorProjectV17, validateAudioEditorProjectV17 } from '../src/common/editor/project-v17.ts';
import { createAudioClip, createAudioSource, createAudioTrack } from '../src/common/editor/project-media-factory.ts';

for (const names of [['B', 'b'], ['b', 'B']]) {
	test(`native SortByName then removing the first track retains B: ${names.join(',')}`, () => {
		const fixture = sortFixture(names);
		fixture.runNative(); fixture.removeFirst();
		assert.deepEqual(fixture.names(), ['B']);
	});

	test(`ordinary local name sorting retains stable case-fold ordering: ${names.join(',')}`, () => {
		const fixture = sortFixture(names); fixture.runLocal();
		assert.deepEqual(fixture.names(), names);
	});
}

test('native sorting keeps identical lowercase names in their original relative order', () => {
	const fixture = sortFixture(['B', 'b', 'b']); fixture.runNative();
	assert.deepEqual(fixture.ids(), ['t1', 't2', 't0']);
});

test('native name changes leave ordinary non-tie ordering intact', () => {
	const fixture = sortFixture(['Zulu', 'Alpha']); fixture.runNative();
	assert.deepEqual(fixture.names(), ['Alpha', 'Zulu']);
});

test('normalization-only equivalence does not invent a native case tie', () => {
	const fixture = sortFixture(['ⓑ', 'B']); fixture.runNative();
	assert.deepEqual(fixture.names(), ['ⓑ', 'B']);
});

test('native name reordering respects track locks without publishing a partial order', () => {
	const fixture = sortFixture(['B', 'b'], true);
	assert.throws(() => fixture.runNative(), /locked track/iu);
	assert.deepEqual(fixture.names(), ['B', 'b']);
});

test('legacy SortByName shortcuts decline the ordinary stable case-fold ordering', () => {
	const plan = parseAudacityShortcutImport('<audacitykeyboard><command name="SortByName" key="Ctrl+Alt+Shift+F7"/></audacitykeyboard>',
		{ 'sort-by-name': [] }, { availableActionIds: ['sort-by-name'] });
	assert.equal(plan.importedCount, 0);
	assert.deepEqual(plan.skipped, [{ command: 'SortByName', reason: 'unsupported-command' }]);
});

test('modern sort-by-name shortcuts retain the ordinary local action', () => {
	const plan = parseAudacityShortcutImport('<Shortcuts><SC><key>sort-by-name</key><seq>Ctrl+Alt+Shift+F7</seq></SC></Shortcuts>',
		{ 'sort-by-name': [] }, { availableActionIds: ['sort-by-name'] });
	assert.equal(plan.importedCount, 1);
	assert.deepEqual(plan.shortcuts['sort-by-name'], ['Ctrl+Alt+Shift+F7']);
});

function sortFixture(names: readonly string[], locked = false) {
	let project = createAudioEditorProjectV17({ id: 'native-name-sort', sampleRate: 8000,
		sources: [createAudioSource({ id: 'source', storageKey: 'source', sampleRate: 8000, channelCount: 1, frameCount: 8000 })],
		tracks: names.map((name, index) => createAudioTrack({ id: `t${index}`, name, clipIds: [`c${index}`] }, 8000)),
		clips: names.map((_, index) => createAudioClip({ id: `c${index}`, sourceId: 'source', timelineStartFrame: 0, durationFrames: 1000 })),
	});
	if (locked) project = applyEditorCommand(project, { type: 'track/update', trackId: 't0', changes: { locked: true } });
	assert.ok(validateAudioEditorProjectV17(project));
	const view = () => ({ ...project, tracks: project.tracks.map(track => ({ ...track })), sources: project.sources.map(source => ({ ...source })),
		clips: project.clips.map(clip => {
			if (typeof clip.durationFrames !== 'number' || typeof clip.timelineStartFrame !== 'number') assert.fail('The fixture requires sample-anchored clips.');
			return { ...clip, durationFrames: clip.durationFrames, timelineStartFrame: clip.timelineStartFrame };
		}),
	});
	const service = createTrackStructuralOperationService({ getProject: view, getSelectedTrackId: () => null,
		editingBlocked: () => false, getPositionFrames: () => 0, lifetime: { assertActive() {} },
		commit: command => { project = applyEditorCommand(project, command); },
	});
	const macro = createMacroCommandService({ getProject: view, projectSampleRate: () => 8000,
		timelineDurationFrames: () => 1000, getActions: () => ({ track: service,
			edit: { commit: (command: Parameters<typeof applyEditorCommand>[1]) => { project = applyEditorCommand(project, command); } },
		}), setExactSelection: (startFrame, endFrame, details) => {
			const trackIds = Array.isArray(details?.trackIds) ? details.trackIds.filter((id: unknown): id is string => typeof id === 'string') : [];
			project = applyEditorCommand(project, { type: 'selection/set', startFrame, endFrame, trackIds });
		},
	});
	return { runNative: () => macro.runMacroCommand(createMacroCommandStep('SortByName')), runLocal: () => service.sortByName(),
		names: () => project.tracks.map(track => track.name), ids: () => project.tracks.map(track => track.id),
		removeFirst() {
			macro.runMacroCommand(createMacroCommandStep('SelectTracks', { params: { track: 0, trackCount: 1, mode: 'set' } }));
			macro.runMacroCommand(createMacroCommandStep('RemoveTracks'));
			assert.ok(validateAudioEditorProjectV17(project));
		},
	};
}
