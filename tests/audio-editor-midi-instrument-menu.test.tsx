/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { SoundscaperNativeEffectManagePanel } from '../src/common/editor/ui/dialogs/SoundscaperNativeEffectPanels.tsx';
import { EMPTY_SOUNDSCAPER_NATIVE_SERVICES_DIALOG_STATE } from '../src/common/editor/ui/soundscaper-native-services-dialog-model.ts';
import { resolveSoundscaperNativeServicesCopy } from '../src/common/editor/ui/soundscaper-native-services-copy.ts';
import { withMidiTrackData } from '../src/common/editor/midi-model.ts';
import type { NativePluginEntryView } from '../src/common/editor/native-plugin-host-contract.ts';

const surge: NativePluginEntryView = { entryId: 'surge', stablePluginId: 'surge', name: 'Surge XT', format: 'vst3',
	vendor: 'Surge Synth Team', classification: 'instrument', eligible: true, ineligibleReason: null,
	installations: [{ installationId: 'surge', version: '1', allowed: true, selected: true, quarantined: false }] };
const entries = [surge, { ...surge, entryId: 'dexed', name: 'Dexed' },
	{ ...surge, entryId: 'effect', name: 'Chorus', classification: 'effect' }];
const midi = withMidiTrackData({ id: 'midi', type: 'audio' }, { version: 1, instrument: 'triangle' });

function panel(instrumentOnly: boolean, selectedTrackId: string) {
	return renderToStaticMarkup(<SoundscaperNativeEffectManagePanel copy={resolveSoundscaperNativeServicesCopy()}
		disabled={false} instrumentOnly={instrumentOnly} perform={() => {}}
		controller={{ project: { tracks: [midi, { id: 'audio', type: 'audio' }] }, getSnapshot: () => ({ selectedTrackId }) }}
		state={{ ...EMPTY_SOUNDSCAPER_NATIVE_SERVICES_DIALOG_STATE, registry: { entries } }} />);
}

test('Surge XT and Dexed are visible only in the MIDI instrument manager', () => {
	const instruments = panel(true, 'midi');
	assert.match(instruments, />Surge XT<|>Surge XT<\/button>/u);
	assert.match(instruments, />Dexed</u);
	assert.doesNotMatch(instruments, />Chorus</u);
	for (const html of [panel(false, 'midi'), panel(false, 'audio'), panel(true, 'audio')]) {
		assert.doesNotMatch(html, /Surge XT|Dexed/u);
	}
	assert.match(panel(false, 'audio'), />Chorus</u);
});
