/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const UI = new URL('../src/common/editor/ui/', import.meta.url);

test('toolbar playback telemetry is owned by focused leaf controls', async () => {
	const [toolbar, transportGroup, meter, actionRuntime] = await Promise.all([
		readFile(new URL('toolbar/EditorToolToolbar.jsx', UI), 'utf8'),
		readFile(new URL('toolbar/TransportToolbarGroup.jsx', UI), 'utf8'),
		readFile(new URL('toolbar/AudioEditorMeterControls.jsx', UI), 'utf8'),
		readFile(new URL('../audacity-action-runtime.js', UI), 'utf8'),
	]);

	assert.doesNotMatch(toolbar, /useAudioEditorTelemetrySelector/u);
	assert.doesNotMatch(transportGroup, /useAudioEditorTelemetrySelector/u);
	assert.match(meter, /audioDevices\.setPlaybackGain/u);
	assert.doesNotMatch(meter, /effects\.setMasterGain/u);
	assert.match(actionRuntime, /setPlaybackLevel:.*audioDevices\.setPlaybackGain/u);
});

test('track and output control panels delegate meters to telemetry leaves', async () => {
	const [trackControls, outputRows] = await Promise.all([
		readFile(new URL('timeline/TrackControls.jsx', UI), 'utf8'),
		readFile(new URL('timeline/OutputTrackRows.jsx', UI), 'utf8'),
	]);
	const outputControls = outputRows.slice(outputRows.indexOf('export function OutputTrackControls'));

	assert.doesNotMatch(trackControls, /useAudioEditorTelemetrySelector/u);
	assert.doesNotMatch(outputControls, /useAudioEditorTelemetrySelector/u);
});

test('mixer channel shells delegate high-frequency meters to focused leaves', async () => {
	const panel = await readFile(new URL('workspace/AudioEditorMixerPanel.jsx', UI), 'utf8');
	assert.doesNotMatch(panel, /useAudioEditorTelemetrySelector/u);
	assert.doesNotMatch(panel, /telemetry\.meters/u);
});
