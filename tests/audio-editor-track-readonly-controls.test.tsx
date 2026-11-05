/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { TrackControls } from '../src/common/editor/ui/timeline/TrackControls.jsx';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import { installReactTestDom } from './helpers/react-test-dom.ts';

for (const trackHeight of [60, 180]) {
	for (const readOnly of [false, true]) test(`${trackHeight}px track parameters reflect read-only=${readOnly} independently of other busy state`, async () => {
		const dom = installReactTestDom();
		const root = createRoot(dom.container as unknown as HTMLElement);
		const priorReact = Object.getOwnPropertyDescriptor(globalThis, 'React');
		const globals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
		const priorAct = globals.IS_REACT_ACT_ENVIRONMENT;
		globals.IS_REACT_ACT_ENVIRONMENT = true;
		Object.defineProperty(globalThis, 'React', { configurable: true, value: React });
		const track = { id: 'voice', name: 'Voice', type: 'audio', gain: 1, pan: 0 };
		const controller = {
			getSnapshot: () => ({ readOnly, project: { id: 'project', tracks: [track], clips: [] } }),
			getTelemetrySnapshot: () => ({ meters: {} }), subscribeTelemetry: () => () => undefined,
			actions: { track: { update() {} }, timeline: { selectTrack() {} }, mixer: {
				beginParameterGesture() {}, previewParameterGesture() {}, commitParameterGesture() {}, cancelParameterGesture() {},
			} },
		};
		try {
			await act(async () => { root.render(<TrackControls controller={controller} track={track} trackHeight={trackHeight}
				panelWidth={240} selected blocked showArmControls={false} displayAudioSupported={false} recordingInputs={[]}
				automationTargets={[]} automationTarget={undefined} automationRuntime={undefined} isFlatNavigation={false}
				copy={ENGLISH_COPY} run={(operation: () => unknown) => operation()} onMenu={() => undefined}
				onOpenEffects={() => undefined} onAutomationTarget={() => undefined} onTabOut={() => undefined}
				onShiftTabOut={() => undefined} onNavigateVertical={() => undefined} />); });
			for (const name of ['Mute', 'Solo']) {
				assert.equal(dom.one(`[aria-label="${name}"]`).hasAttribute('disabled'), readOnly);
			}
			if (trackHeight > 70) {
				assert.equal(dom.one('.slider__input').hasAttribute('disabled'), readOnly);
				assert.equal(dom.one('.knob').hasAttribute('disabled'), readOnly);
				const effects = dom.container.querySelectorAll('button').find(button => button.textContent === 'Effects');
				assert.ok(effects);
				assert.equal(effects.hasAttribute('disabled'), false, 'read-only effect settings remain inspectable');
			}
			assert.equal(dom.one('[aria-label="Track menu"]').hasAttribute('disabled'), false);
		} finally {
			await act(async () => { root.unmount(); });
			if (priorReact) Object.defineProperty(globalThis, 'React', priorReact);
			else Reflect.deleteProperty(globalThis, 'React');
			globals.IS_REACT_ACT_ENVIRONMENT = priorAct;
			dom.restore();
		}
	});
}
