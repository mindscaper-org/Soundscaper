/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { SideRecordingMeter, RecordingMeterToolbarGroup } from '../src/common/editor/ui/toolbar/AudioEditorMeterControls.jsx';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import { DEFAULT_RECORDING_METER_SETTINGS } from '../src/common/editor/ui/meter-settings.ts';

function render(channelCount: 1 | 2 | null, selectedCount: 1 | 2, toolbar: boolean): string {
	const prior = Object.getOwnPropertyDescriptor(globalThis, 'React');
	Object.defineProperty(globalThis, 'React', { configurable: true, value: React });
	const inputMeter = channelCount === null ? null : {
		peak: .8, rms: .4, dbfs: 20 * Math.log10(.8),
		channels: Array.from({ length: channelCount }, (_, index) => ({ peak: index ? 0 : .8, rms: index ? 0 : .4 })),
	};
	try {
		return renderToStaticMarkup(React.createElement(toolbar ? RecordingMeterToolbarGroup : SideRecordingMeter, {
			controller: { getTelemetrySnapshot: () => ({ inputMeter }), subscribeTelemetry: () => () => undefined },
			copy: ENGLISH_COPY,
			snapshot: { recording: true, selectedTrackId: 'unarmed', recordingInputs: {
				routes: { unarmed: { channelCount: selectedCount } },
			} },
			settings: { ...DEFAULT_RECORDING_METER_SETTINGS, position: toolbar ? 'top' : 'panel' },
			onSettingsChange: () => undefined, run: () => undefined,
		}));
	} finally {
		if (prior) Object.defineProperty(globalThis, 'React', prior);
		else Reflect.deleteProperty(globalThis, 'React');
	}
}

function bars(markup: string): number {
	return [...markup.matchAll(/class="kw-audio-editor__playback-meter-channel"/gu)].length;
}

for (const toolbar of [false, true]) {
	for (const recorded of [1, 2] as const) test(`${toolbar ? 'toolbar' : 'panel'} meter displays ${recorded} captured channels while a different-width unarmed track is selected`, () => {
		assert.equal(bars(render(recorded, recorded === 2 ? 1 : 2, toolbar)), recorded);
	});
	test(`${toolbar ? 'toolbar' : 'panel'} meter retains selected route width before channel telemetry is available`, () => {
		assert.equal(bars(render(null, 2, toolbar)), 2);
	});
}
