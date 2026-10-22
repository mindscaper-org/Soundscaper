/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import { createSoundscaperProjectRuntimeSelection } from '../src/soundscaper/editor-project-runtime-selection.ts';
import { COPY, createAudioEditorController, createMemoryEngine, createProjectStore } from './helpers/audio-editor-controller-harness.js';
import { createMemoryFfmpeg } from './helpers/audio-editor-controller-fixtures.js';
import { AccessibleSelectionToolbar } from '../src/common/editor/ui/toolbar/AudioEditorTransportControls.jsx';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

test('sample digit replacement keeps the native selection editable through a transient collapsed endpoint', async context => {
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
	type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;
	const runtime = createSoundscaperProjectRuntimeSelection();
	const controller = createAudioEditorController(null, { headless: true, locale: 'en', copy: COPY,
		projectRuntime: runtime, sessionController: runtime.createSessionController(),
		store: createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: 'selection-digit-collapse' }),
		engine: createMemoryEngine() as unknown as Options['engine'], ffmpeg: createMemoryFfmpeg() as unknown as Options['ffmpeg'],
	});
	context.after(async () => { await controller.dispose(); });
	await controller.ready;
	await controller.actions.generators.generate('silence', { durationSeconds: 1, channelCount: 1 });
	controller.actions.timeline.setSelection(24_001, 48_000);
	const render = async () => {
		await act(async () => root.render(<AccessibleSelectionToolbar controller={controller}
			snapshot={controller.getSnapshot()} copy={ENGLISH_COPY} statusMessage="Ready" statusState="success"
			durationFrames={sampleRate} disabled={false} showSelectionToolbar showStatusbar run={(operation: () => unknown) => operation()} />));
	};
	try {
		await render();
		const end = dom.container.querySelectorAll('.timecode')[1]; assert.ok(end);
		const format = end.querySelector('.timecode__format-button'); assert.ok(format);
		await act(async () => { reactProps(format).onClick?.(); });
		const samples = dom.container.querySelectorAll('[role="menuitem"]').find(node => node.textContent === 'samples'); assert.ok(samples);
		await act(async () => { reactProps(samples).onClick?.({ stopPropagation() {} }); });
		const digit = end.querySelectorAll('.timecode-digit')[7]; assert.ok(digit);
		digit.focus();
		await act(async () => { reactProps(digit).onClick?.(); });
		for (const key of '24002') {
			await act(async () => {
				const event = Object.assign(new Event('keydown', { cancelable: true }), { key });
				for (const listener of [...keys]) {
					if (typeof listener === 'function') listener(event); else listener.handleEvent(event);
				}
			});
			await render();
		}
		const selected: unknown = controller.getSnapshot().selection;
		assert.ok(selected && typeof selected === 'object' && 'startFrame' in selected && 'endFrame' in selected);
		assert.equal(selected.startFrame, 24_001);
		assert.equal(selected.endFrame, 24_002);
		const last = end.querySelectorAll('.timecode-digit').at(-1); assert.ok(last);
		last.focus();
		await act(async () => { reactProps(last).onClick?.(); });
		await act(async () => {
			const event = Object.assign(new Event('keydown', { cancelable: true }), { key: '1' });
			for (const listener of [...keys]) {
				if (typeof listener === 'function') listener(event); else listener.handleEvent(event);
			}
		});
		await render();
		assert.equal(controller.getSnapshot().selection, null, 'an intentionally collapsed endpoint remains a cursor');
		const wrapper = dom.one('[data-selection-toolbar]');
		const committedDigit = dom.container.querySelectorAll('.timecode')[1]?.querySelectorAll('.timecode-digit').at(-1); assert.ok(committedDigit);
		await act(async () => reactProps(wrapper).onKeyDownCapture({ key: 'Enter', target: committedDigit }));
		await render();
		await act(async () => {
			const event = Object.assign(new Event('keydown', { cancelable: true }), { key: '9' });
			for (const listener of [...keys]) {
				if (typeof listener === 'function') listener(event); else listener.handleEvent(event);
			}
		});
		await render();
		assert.equal(controller.getSnapshot().selection, null, 'commit retires the editing draft after an intentional collapse');
	} finally {
		await act(async () => { root.unmount(); });
		globals.IS_REACT_ACT_ENVIRONMENT = priorAct; globals.React = priorReact;
		if (previousObserver) Object.defineProperty(globalThis, 'MutationObserver', previousObserver);
		else Reflect.deleteProperty(globalThis, 'MutationObserver');
		dom.restore();
	}
});
