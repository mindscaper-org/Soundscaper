/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { createAudioClip, createAudioSource, createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { AccessibleSelectionToolbar } from '../src/common/editor/ui/toolbar/AudioEditorTransportControls.jsx';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

for (const sampleRate of [44_100, 48_000]) test(`precise selection entry includes blank timeline after a ${sampleRate}Hz imported clip`, async () => {
	const dom = installReactTestDom();
	window.getComputedStyle = () => ({ display: 'block', visibility: 'visible' }) as CSSStyleDeclaration;
	const globals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean; React?: typeof React };
	const priorAct = globals.IS_REACT_ACT_ENVIRONMENT, priorReact = globals.React;
	const previousObserver = Object.getOwnPropertyDescriptor(globalThis, 'MutationObserver');
	Object.defineProperty(globalThis, 'MutationObserver', { configurable: true, value: class { observe() {} disconnect() {} } });
	globals.IS_REACT_ACT_ENVIRONMENT = true; globals.React = React;
	const root = createRoot(dom.container as unknown as Element);
	const source = createAudioSource({ id: 'source', sampleRate, frameCount: sampleRate, channelCount: 1 });
	const clip = createAudioClip({ id: 'clip', sourceId: source.id, durationFrames: sampleRate, sourceDurationFrames: sampleRate });
	const project = createSoundscaperProject({ id: 'selection-after-content', sampleRate, sources: [source], clips: [clip],
		tracks: [createAudioTrack({ id: 'track', clipIds: [clip.id] })] });
	const selections: number[][] = [], telemetry = { taskProgress: null };
	const controller = { subscribeTelemetry: () => () => undefined, getTelemetrySnapshot: () => telemetry,
		actions: { timeline: { setSelection: (start: number, end: number) => { selections.push([start, end]); } } } };
	try {
		await act(async () => { root.render(<AccessibleSelectionToolbar controller={controller}
			snapshot={{ project, selection: { startFrame: 0, endFrame: sampleRate } }} copy={ENGLISH_COPY}
			statusMessage="Ready" statusState="success" durationFrames={sampleRate} disabled={false}
			showSelectionToolbar showStatusbar run={(operation: () => unknown) => operation()} />); });
		const end = dom.container.querySelectorAll('.timecode')[1]; assert.ok(end);
		const display = end.querySelector('.timecode__display'); assert.ok(display);
		await act(async () => { reactProps(display).onDoubleClick?.({}); });
		const input = end.querySelector('input'); assert.ok(input);
		await act(async () => { reactProps(input).onChange?.({ currentTarget: { value: '2' } }); });
		await act(async () => { reactProps(input).onKeyDown?.({ key: 'Enter', preventDefault() {}, stopPropagation() {} }); });
		assert.deepEqual(selections, [[0, sampleRate * 2]], 'the same two-second range the ruler can select is authored precisely');
	} finally {
		await act(async () => { root.unmount(); });
		globals.IS_REACT_ACT_ENVIRONMENT = priorAct; globals.React = priorReact;
		if (previousObserver) Object.defineProperty(globalThis, 'MutationObserver', previousObserver);
		else Reflect.deleteProperty(globalThis, 'MutationObserver');
		dom.restore();
	}
});
