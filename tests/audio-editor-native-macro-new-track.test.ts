/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createMacroCommandService } from '../src/common/editor/controller/effects/internal/macro/macro-command-service.ts';
import { createMacroCommandStep } from '../src/common/editor/macro-command-steps.ts';
import { applyEditorCommand } from '../src/common/editor/commands.js';
import type { AudioEditorCommand } from '../src/common/editor/commands/protocol.ts';
import { createAudioEditorProjectV17, validateAudioEditorProjectV17 } from '../src/common/editor/project-v17.ts';
import { createAudioSource, createAudioClip, createAudioTrack } from '../src/common/editor/project-media-factory.ts';

for (const command of ['NewMonoTrack', 'NewStereoTrack']) test(`${command} selects only its new lane and preserves temporal and spectral bounds`, () => {
	const f = fixture(); f.run(command);
	assert.deepEqual(f.project().selection, { ...f.originalSelection, trackIds: ['created'], clipIds: [] });
	f.run('RemoveTracks');
	assert.deepEqual(f.project().tracks.map(track => track.id), ['voice']);
	assert.equal(f.project().clips.length, 1, 'removing the newly created lane cannot delete the original recording');
	assert.ok(validateAudioEditorProjectV17(f.project()));
});

test('ordinary local add-track action retains its existing document selection', () => {
	const f = fixture(); f.add();
	assert.deepEqual(f.project().selection, f.originalSelection);
});

for (const failure of ['null', 'missing', 'old', 'changed-project', 'throws'] as const) test(`native new-track ${failure} cannot leave the old selection for a destructive following step`, () => {
	const f = fixture(failure);
	assert.throws(() => { f.run('NewMonoTrack'); f.run('RemoveTracks'); }, failure === 'throws' ? /creation failed/u : /did not create a track in the current project/u);
	assert.equal(f.project().clips.length, 1);
	assert.deepEqual(f.project().selection, f.originalSelection);
});

function fixture(failure?: 'null' | 'missing' | 'old' | 'changed-project' | 'throws') {
	let project = createAudioEditorProjectV17({ id: 'native-creation', sampleRate: 8000,
		sources: [createAudioSource({ id: 'source', storageKey: 'source', sampleRate: 8000, channelCount: 1, frameCount: 8000 })],
		clips: [createAudioClip({ id: 'clip', sourceId: 'source', durationFrames: 8000 })],
		tracks: [createAudioTrack({ id: 'voice', clipIds: ['clip'] }, 8000)],
		selection: { startFrame: 1000, endFrame: 3000, trackIds: ['voice'], clipIds: [], frequencyRange: { minimumFrequency: 100, maximumFrequency: 400 } },
	});
	const originalSelection = structuredClone(project.selection);
	const add = () => {
		if (failure === 'throws') throw new Error('creation failed');
		if (failure === 'null') return null;
		if (failure === 'missing') return 'missing';
		if (failure === 'old') return 'voice';
		project = applyEditorCommand(project, { type: 'track/add', track: { ...createAudioTrack({ id: 'created' }, 8000) } });
		if (failure === 'changed-project') project = { ...project, id: 'other-project' };
		return 'created';
	};
	const service = createMacroCommandService({ getProject: () => ({ ...project, tracks: project.tracks.map(track => ({ ...track })) }),
		getSelectedTrackId: () => project.tracks.some(track => track.id === 'created') ? 'created' : 'voice',
		projectSampleRate: () => 8000, timelineDurationFrames: () => 8000,
		setExactSelection: (startFrame, endFrame, details) => { project = { ...project, selection: { ...project.selection, ...details, startFrame, endFrame } }; },
		getActions: () => ({ track: { addMono: add, addStereo: add }, edit: { commit: (command: AudioEditorCommand) => { project = applyEditorCommand(project, command); } } }),
	});
	return { run: (command: string) => service.runMacroCommand(createMacroCommandStep(command)), add, project: () => project, originalSelection };
}
