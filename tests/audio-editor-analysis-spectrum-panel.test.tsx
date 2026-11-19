/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import RealtimeAnalysisPanel from '../src/common/editor/ui/inspector/RealtimeAnalysisPanel.jsx';
import { DEFAULT_PLAYBACK_METER_SETTINGS } from '../src/common/editor/ui/meter-settings.ts';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

test('Analysis panel switches its spectrum between live tracks and the selected range', async context => {
	context.mock.timers.enable({ apis: ['setTimeout'] });
	const dom = installReactTestDom();
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const previousAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
	const previousReact = Object.getOwnPropertyDescriptor(globalThis, 'React');
	actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	Object.defineProperty(globalThis, 'React', { configurable: true, value: React });
	let live = 0, offline = 0;
	const controller = {
		engine: { acquirePlaybackSpectrum: () => {
			live++;
			return { fftSize: 4096, release: () => { live--; }, read: (id: string | null, target: Float32Array) => {
				target.fill(-Infinity); target[id === 'bass' ? 64 : 512] = -12;
				return { fftSize: 4096, sampleRate: 48_000, frequencyBinCount: 2048, minDecibels: -120, maxDecibels: 0 };
			} };
		}, getPositionFrames: () => 0 },
		actions: { analysis: { plotSpectrum: async () => {
			offline++;
			return { type: 'spectrum', bins: [{ frequency: 1000, db: -6 }], peak: { frequency: 1000, db: -6 }, size: 2048, sampleRate: 48_000 };
		} } },
		getTelemetrySnapshot: () => ({ meters: {} }), subscribeTelemetry: () => () => {},
	};
	const snapshot = { ready: true, project: { id: 'spectrum-panel', revision: 1, sampleRate: 48_000,
		tracks: [{ id: 'bass', type: 'audio', name: 'Bass', color: 'blue', clipIds: ['bass-clip'] },
			{ id: 'lead', type: 'audio', name: 'Lead', color: 'orange', clipIds: ['lead-clip'] }],
		clips: [{ id: 'bass-clip', trackId: 'bass', timelineStartFrame: 0, durationFrames: 48_000 },
			{ id: 'lead-clip', trackId: 'lead', timelineStartFrame: 0, durationFrames: 48_000 }],
		selection: { startFrame: 0, endFrame: 0, trackIds: [] as string[], clipIds: [] as string[] },
	} };
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	const render = (active = true) => <RealtimeAnalysisPanel controller={controller} snapshot={snapshot}
		copy={ENGLISH_COPY} settings={DEFAULT_PLAYBACK_METER_SETTINGS} active={active} />;
	try {
		await act(async () => root.render(render()));
		assert.equal(live, 0);
		const section = dom.one('[data-analysis-section="spectrum"]');
		await act(async () => reactProps(section).onToggle({ currentTarget: { open: true } }));
		assert.equal(live, 1, 'the panel itself must acquire independent playback spectra');
		assert.match(dom.container.textContent, /Bass.*750\.0 Hz/);
		assert.match(dom.container.textContent, /Lead.*6000\.0 Hz/);
		assert.equal(offline, 0);
		snapshot.project.selection = { startFrame: 100, endFrame: 20_000, trackIds: ['bass'], clipIds: [] };
		await act(async () => root.render(render()));
		await act(async () => { context.mock.timers.tick(120); });
		assert.equal(live, 0, 'range analysis must release playback taps');
		assert.equal(offline, 1);
		assert.match(dom.container.textContent, /1000\.0 Hz/);
		snapshot.project.selection = { startFrame: 0, endFrame: 0, trackIds: [], clipIds: [] };
		await act(async () => root.render(render()));
		assert.equal(live, 1, 'clearing the range resumes the same panel live');
		await act(async () => root.render(render(false)));
		assert.equal(live, 0, 'hidden workspace tabs must stop sampling');
	} finally {
		await act(async () => root.unmount());
		actGlobal.IS_REACT_ACT_ENVIRONMENT = previousAct;
		if (previousReact) Object.defineProperty(globalThis, 'React', previousReact);
		else Reflect.deleteProperty(globalThis, 'React');
		dom.restore();
	}
});
