/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { AccessibleSelectionToolbar } from '../src/common/editor/ui/toolbar/AudioEditorTransportControls.jsx';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

for (const rate of [{ num: 25, den: 1 }, { num: 50, den: 1 }]) test(`selection frame entry uses the native ${rate.num}/${rate.den} sequence`, async () => {
	const dom = installReactTestDom();
	window.getComputedStyle = () => ({ display: 'block', visibility: 'visible' }) as CSSStyleDeclaration;
	const globals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean; React?: typeof React };
	const priorAct = globals.IS_REACT_ACT_ENVIRONMENT, priorReact = globals.React;
	const previousObserver = Object.getOwnPropertyDescriptor(globalThis, 'MutationObserver');
	Object.defineProperty(globalThis, 'MutationObserver', { configurable: true, value: class { observe() {} disconnect() {} } });
	globals.IS_REACT_ACT_ENVIRONMENT = true; globals.React = React;
	const keys = new Set<EventListenerOrEventListenerObject>();
	document.addEventListener = (type: string, listener: EventListenerOrEventListenerObject | null) => { if (type === 'keydown' && listener) keys.add(listener); };
	document.removeEventListener = (type: string, listener: EventListenerOrEventListenerObject | null) => { if (type === 'keydown' && listener) keys.delete(listener); };
	const root = createRoot(dom.container as unknown as Element);
	const sampleRate = 48_000;
	const project = createSoundscaperProject({ id: 'selection-frame-rate', sampleRate, primarySequenceId: 'main',
		sequences: [{ id: 'main', rate, trackIds: [] }] });
	const selections: number[][] = [], telemetry = { taskProgress: null };
	const controller = { subscribeTelemetry: () => () => undefined, getTelemetrySnapshot: () => telemetry,
		actions: { timeline: { setSelection: (start: number, end: number) => { selections.push([start, end]); } } } };
	try {
		await act(async () => { root.render(<AccessibleSelectionToolbar controller={controller}
			snapshot={{ project, selection: { startFrame: 0, endFrame: sampleRate } }} copy={ENGLISH_COPY}
			statusMessage="Ready" statusState="success" durationFrames={sampleRate} disabled={false}
			showSelectionToolbar showStatusbar run={(operation: () => unknown) => operation()} />); });
		const end = dom.container.querySelectorAll('.timecode')[1]; assert.ok(end);
		const format = end.querySelector('.timecode__format-button'); assert.ok(format);
		await act(async () => { reactProps(format).onClick?.(); });
		const video = dom.container.querySelectorAll('[role="menuitem"]').find(node => node.textContent.startsWith('Video frames')); assert.ok(video);
		await act(async () => { reactProps(video).onClick?.({ stopPropagation() {} }); });
		const frames = dom.container.querySelectorAll('[role="menuitem"]').find(node => node.textContent.startsWith('hh:mm:ss + frames')); assert.ok(frames);
		await act(async () => { reactProps(frames).onClick?.({ stopPropagation() {} }); });
		const digit = end.querySelectorAll('.timecode-digit').at(-1); assert.ok(digit);
		digit.focus();
		await act(async () => { reactProps(digit).onClick?.(); });
		await act(async () => {
			const event = Object.assign(new Event('keydown', { cancelable: true }), { key: '1' });
			for (const listener of [...keys]) {
				if (typeof listener === 'function') listener(event); else listener.handleEvent(event);
			}
		});
		assert.deepEqual(selections, [[0, sampleRate + Math.round(sampleRate * rate.den / rate.num)]], 'one sequence frame must not become one 24fps frame');
	} finally {
		await act(async () => { root.unmount(); });
		globals.IS_REACT_ACT_ENVIRONMENT = priorAct; globals.React = priorReact;
		if (previousObserver) Object.defineProperty(globalThis, 'MutationObserver', previousObserver);
		else Reflect.deleteProperty(globalThis, 'MutationObserver');
		dom.restore();
	}
});
