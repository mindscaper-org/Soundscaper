/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import {
	AUDIO_EDITOR_BUILT_IN_WORKSPACES,
	applyAudioEditorWorkspace,
	createAudioEditorPreferencesV1,
	loadAudioEditorPreferencesV1,
} from '../src/common/editor/preferences.js';
import { createApplicationWindowMenu } from '../src/common/editor/ui/application-window-menu.js';
import { createMidiExportMenuItems, createMidiTrackMenuItems } from '../src/common/editor/ui/midi-application-menu.ts';
import { workspacePanelLabel } from '../src/common/editor/ui/workspace/workspace-panel-model.ts';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';

test('piano roll remains hidden in every preset and older saved preferences', () => {
	const preferences = createAudioEditorPreferencesV1();
	for (const id of AUDIO_EDITOR_BUILT_IN_WORKSPACES) {
		assert.equal(applyAudioEditorWorkspace(preferences, id).workspace.panels['piano-roll']?.visible, false, id);
	}
	const older = structuredClone(preferences);
	delete older.workspace.panels['piano-roll'];
	assert.equal(loadAudioEditorPreferencesV1(older).preferences.workspace.panels['piano-roll']?.visible, false);
	assert.equal(workspacePanelLabel(ENGLISH_COPY, 'piano-roll'), 'Piano roll (beta)');
});

test('MIDI track and export actions use beta labels and honor blocking and available material', () => {
	const calls: string[] = [];
	const context = { copy: {}, productId: 'soundscaper', blocked: false };
	const tracks = createMidiTrackMenuItems(context, () => { calls.push('track'); });
	assert.deepEqual(tracks.map(({ id, label }) => ({ id, label })), [{ id: 'new-midi-track', label: 'MIDI track (beta)' }]);
	assert.equal(tracks[0]?.disabled, false);
	tracks[0]?.onClick();
	assert.equal(createMidiTrackMenuItems({ ...context, blocked: true }, () => undefined)[0]?.disabled, true);
	const exports = createMidiExportMenuItems({ ...context, midiAvailable: true }, {
		midi: () => { calls.push('midi'); }, allegro: () => { calls.push('allegro'); },
	});
	assert.deepEqual(exports.map(({ label }) => label), ['Export MIDI (beta)', 'Export Allegro (beta)']);
	for (const item of exports) item.onClick();
	assert.deepEqual(calls, ['track', 'midi', 'allegro']);
	assert.ok(createMidiExportMenuItems({ ...context, midiAvailable: false }, { midi: () => undefined, allegro: () => undefined }).every(({ disabled }) => disabled));
});

test('Window exposes the optional piano roll and reflects visibility', () => {
	const calls: string[] = [];
	const preferences = createAudioEditorPreferencesV1();
	const menu = createApplicationWindowMenu({
		blocked: false, capabilities: {}, copy: ENGLISH_COPY, divider: () => ({ divider: true }),
		preferences, productId: 'soundscaper', productItems: { mixer: [] }, project: null, snapshot: {},
	}, { togglePanel: (id: string) => { calls.push(id); } }, {});
	const item = menu.items.find((entry: { id?: string }) => entry.id === 'panel-piano-roll');
	assert.ok(item);
	assert.equal(item.label, 'Piano roll (beta)');
	assert.equal(item.checked, false);
	item.onClick();
	assert.deepEqual(calls, ['piano-roll']);
});
