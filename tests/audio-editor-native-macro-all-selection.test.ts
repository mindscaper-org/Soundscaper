/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createMacroCommandService, type MacroCommandProject, type MacroCommandSelection } from '../src/common/editor/controller/effects/internal/macro/macro-command-service.ts';
import { createMacroCommandStep } from '../src/common/editor/macro-command-steps.ts';
import { audacityShortcutImportCommand } from '../src/common/editor/audacity-shortcut-import-commands.ts';

for (const command of ['SelectAll', 'SelAllTracks']) test(`native ${command} retains the spectral region while adopting the public action time and track scope`, () => {
	const fixture = allSelectionFixture(); fixture.run(command);
	assert.deepEqual(fixture.selection(), { startFrame: command === 'SelectAll' ? 0 : 200, endFrame: command === 'SelectAll' ? 1000 : 400,
		trackIds: ['voice', 'music'], clipIds: [], frequencyRange: { minimumFrequency: 100, maximumFrequency: 400 } });
});

test('local all-selection actions retain their existing frequency reset', () => {
	const fixture = allSelectionFixture(); fixture.localSelectAll();
	assert.equal(fixture.selection().frequencyRange, null);
});

test('native all-selection with no spectral region needs no second selection publication', () => {
	const fixture = allSelectionFixture(null); fixture.run('SelectAll');
	assert.equal(fixture.selection().frequencyRange, null);
	assert.equal(fixture.restorations(), 0);
});

test('native all-selection propagates the owning action failure before restoring any selection', () => {
	const failure = new Error('Owning selection failure'); const fixture = allSelectionFixture(undefined, failure);
	assert.throws(() => fixture.run('SelAllTracks'), error => error === failure);
	assert.equal(fixture.restorations(), 0);
});

test('legacy all-selection aliases decline changed local scope while modern/local actions remain', () => {
	for (const command of ['SelectAll', 'SelAll', 'SelAllTracks']) assert.equal(audacityShortcutImportCommand(command, true), null);
	for (const command of ['select-all', 'select-all-tracks']) assert.equal(audacityShortcutImportCommand(command, false), command);
});

function allSelectionFixture(frequencyRange: MacroCommandSelection['frequencyRange'] = { minimumFrequency: 100, maximumFrequency: 400 }, failure?: Error) {
	let selection: MacroCommandSelection = { startFrame: 200, endFrame: 400, trackIds: ['voice'], clipIds: [], frequencyRange };
	let restored = 0;
	const project = (): MacroCommandProject => ({ tracks: [{ id: 'voice' }, { id: 'music' }], selection });
	const selectAll = (allTime: boolean) => {
		if (failure) throw failure;
		selection = { startFrame: allTime ? 0 : selection.startFrame, endFrame: allTime ? 1000 : selection.endFrame,
			trackIds: ['voice', 'music'], clipIds: [], frequencyRange: null };
		return selection;
	};
	const service = createMacroCommandService({ getProject: project, projectSampleRate: () => 1000, timelineDurationFrames: () => 1000,
		getActions: () => ({ timeline: { selectAll: () => selectAll(true), selectAllTracks: () => selectAll(false) } }),
		setExactSelection: (startFrame, endFrame, details) => { restored += 1; selection = { ...selection, ...details, startFrame, endFrame }; return selection; },
	});
	return { run: (command: string) => service.runMacroCommand(createMacroCommandStep(command)), selection: () => selection,
		localSelectAll: () => selectAll(true), restorations: () => restored };
}
