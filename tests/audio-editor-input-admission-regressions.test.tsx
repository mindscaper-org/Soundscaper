/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import WorkspacePanelContent from '../src/common/editor/ui/workspace/WorkspacePanelContent.jsx';
import RecordingInputSelectors from '../src/common/editor/ui/RecordingInputSelectors.jsx';
import { ShortcutEditorRow } from '../src/common/editor/ui/dialogs/ShortcutEditorRow.tsx';
import { clipSourceFrameToDisplay } from '../src/common/editor/clip-source-timing.ts';
import { normalizeAudioWarpMap } from '../src/common/editor/audio-warp-domain.ts';

Object.assign(globalThis, { React });
const noop = () => undefined;

test('History reflects the same mutation admission as editor actions', () => {
	for (const blocked of [true, false]) {
		const html = renderToStaticMarkup(<WorkspacePanelContent panelId="history" controller={{}} snapshot={{ history: { canUndo: true, canRedo: true } }} copy={ENGLISH_COPY} blocked={blocked} />);
		assert.equal((html.match(/disabled=""/gu) ?? []).length, blocked ? 2 : 0);
	}
});

test('known mono inputs refuse stereo while existing invalid routes remain recoverable', () => {
	const render = (channelCount: number, actualChannels?: number) => renderToStaticMarkup(<RecordingInputSelectors controller={{ actions: { recording: { setTrackInput: noop } } }} track={{ id: 'voice', type: 'audio', name: 'Voice' }} recordingInputs={{ devices: [{ deviceId: 'mic', label: 'Microphone', channelCount: actualChannels, status: 'open' }], routes: { voice: { kind: 'device', deviceId: 'mic', channelStart: 0, channelCount } } }} copy={ENGLISH_COPY} run={noop} displayAudioSupported={false} />);
	assert.match(render(1, 1), /<option value="2" disabled="">/u);
	assert.doesNotMatch(render(1, 1), /Channels 1–2/u);
	assert.match(render(2, 1), /<option value="2" disabled="" selected="">/u);
	assert.match(render(2, 1), /<option value="0" disabled="" selected="">/u);
	assert.doesNotMatch(render(1), /<option value="2" disabled/u);
	assert.doesNotMatch(render(1, 2), /<option value="2" disabled/u);
});

test('shortcut conflicts identify the localized command rather than its internal URI', () => {
	const html = renderToStaticMarkup(<ShortcutEditorRow command={{ id: 'action://cut', label: 'Ausschneiden' }} commands={[{ id: 'action://copy', label: 'Kopieren' }]} preferences={{ shortcuts: { 'action://cut': ['Ctrl+C'], 'action://copy': ['Ctrl+C'] } }} controller={{ actions: { preferences: { setShortcut: noop } } }} copy={{ shortcutConflict: '{binding} is already assigned to {action}.', shortcutInvalid: 'Invalid shortcut' }} run={noop} />);
	assert.ok(html.includes('Ctrl+C is already assigned to Kopieren.'));
});

test('fractional resampled source markers retain their exact output position', () => {
	const clip = { kind: 'audio', anchor: 'sample', timelineStartFrame: 0, sourceStartFrame: 0, sourceDurationFrames: 12000, durationFrames: 48000, warpMap: normalizeAudioWarpMap({ feature: 'audio-warp', points: [{ outer: 0, source: 0, mode: 'forward' }, { outer: 24000, source: { num: 1, den: 4 }, mode: 'forward' }, { outer: 48000, source: 12000, mode: 'forward' }] }) };
	assert.equal(clipSourceFrameToDisplay({ sampleRate: 48000 }, clip, { sampleRate: 12000, frameCount: 12000 }, 0.25), 24000);
});
