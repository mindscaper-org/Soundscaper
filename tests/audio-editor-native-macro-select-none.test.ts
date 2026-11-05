/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createMacroCommandService, type MacroCommandProject, type MacroCommandSelection } from '../src/common/editor/controller/effects/internal/macro/macro-command-service.ts';
import { createMacroCommandStep } from '../src/common/editor/macro-command-steps.ts';
import { audacityShortcutImportCommand } from '../src/common/editor/audacity-shortcut-import-commands.ts';

test('native SelectNone collapses at its current left edge and retains spectral coordinates', () => {
	const fixture = selectionFixture();
	fixture.service.runMacroCommand(createMacroCommandStep('SelectNone'));
	assert.deepEqual(fixture.project().selection, { startFrame: 200, endFrame: 200, trackIds: [], clipIds: [],
		frequencyRange: { minimumFrequency: 100, maximumFrequency: 400 } });
	assert.equal(fixture.focus(), null, 'deselected tracks cannot remain an editing fallback');
});

test('subsequent full-argument native relative commands use the retained collapse origin', () => {
	const fixture = selectionFixture();
	fixture.service.runMacroCommand(createMacroCommandStep('SelectNone'));
	fixture.service.runMacroCommand(createMacroCommandStep('SelectTime', { params: { start: 0.1, end: 0.3, relativeTo: 'selection-start' } }));
	assert.equal(fixture.project().selection?.startFrame, 300);
	assert.equal(fixture.project().selection?.endFrame, 500);
});

test('legacy SelectNone shortcuts decline a local reset while modern clear remains available', () => {
	assert.equal(audacityShortcutImportCommand('SelectNone', true), null);
	assert.equal(audacityShortcutImportCommand('select-none', false), 'clear-selection');
	assert.equal(audacityShortcutImportCommand('clear-selection', false), 'clear-selection');
});

function selectionFixture() {
	let selection: MacroCommandSelection = { startFrame: 200, endFrame: 400, trackIds: ['voice'], clipIds: ['take'],
		frequencyRange: { minimumFrequency: 100, maximumFrequency: 400 } };
	let focus: string | null = 'voice';
	const project = (): MacroCommandProject => ({ tracks: [{ id: 'voice' }], selection });
	const service = createMacroCommandService({ getProject: project, getSelectedTrackId: () => focus,
		projectSampleRate: () => 1000, timelineDurationFrames: () => 1000,
		setExactSelection: (startFrame, endFrame, details) => {
			selection = { ...selection, ...details, startFrame, endFrame };
			return selection;
		},
		getActions: () => ({ timeline: {
			clearSelection: () => { selection = { startFrame: 0, endFrame: 0, trackIds: [], clipIds: [], frequencyRange: null }; },
			selectNoTracks: () => { selection = { ...selection, trackIds: [] }; focus = null; return selection; },
		} }),
	});
	return { project, service, focus: () => focus };
}
