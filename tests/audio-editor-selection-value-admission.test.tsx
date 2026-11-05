/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { AccessibleSelectionToolbar } from '../src/common/editor/ui/toolbar/AudioEditorTransportControls.jsx';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

for (const state of ['empty', 'blocked', 'active'] as const) test(`Selection toolbar ${state} range admits only operable time edits`, async () => {
	const dom = installReactTestDom();
	window.getComputedStyle = () => ({ display: 'block', visibility: 'visible' }) as CSSStyleDeclaration;
	const globals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean; React?: typeof React };
	const priorAct = globals.IS_REACT_ACT_ENVIRONMENT, priorReact = globals.React;
	const priorObserver = Object.getOwnPropertyDescriptor(globalThis, 'MutationObserver');
	Object.defineProperty(globalThis, 'MutationObserver', { configurable: true, value: class { observe() {} disconnect() {} } });
	globals.IS_REACT_ACT_ENVIRONMENT = true; globals.React = React;
	const root = createRoot(dom.container as unknown as Element);
	const project = createSoundscaperProject({ id: 'selection-value-admission' });
	const selections: number[][] = [];
	const controller = { subscribeTelemetry: () => () => undefined, getTelemetrySnapshot: () => ({ taskProgress: null }),
		actions: { timeline: { setSelection: (start: number, end: number) => { selections.push([start, end]); } } } };
	try {
		await act(async () => root.render(<AccessibleSelectionToolbar controller={controller}
			snapshot={{ project, selection: state === 'empty' ? null : { startFrame: 0, endFrame: 48_000 } }}
			copy={ENGLISH_COPY} statusMessage="Ready" statusState="success" durationFrames={96_000}
			disabled={state === 'blocked'} showSelectionToolbar showStatusbar run={(operation: () => unknown) => operation()} />));
		const fields = dom.container.querySelectorAll('.timecode');
		assert.equal(fields.length, 3);
		for (const field of fields.slice(0, 2)) {
			const display = field.querySelector('.timecode__display'); assert.ok(display);
			await act(async () => reactProps(display).onDoubleClick());
			const input = field.querySelector('input');
			if (state === 'active') {
				assert.ok(input);
				await act(async () => reactProps(input).onKeyDown({ key: 'Escape', preventDefault() {}, stopPropagation() {} }));
			} else assert.equal(input, null, 'disabled start/end must not offer a discarded text edit');
		}
		const duration = fields[2]!;
		assert.equal(duration.getAttribute('aria-disabled'), 'false', 'duration remains a view control');
		const format = duration.querySelector('.timecode__format-button'); assert.ok(format);
		assert.equal(format.hasAttribute('disabled'), false);
		if (state === 'active') {
			const end = fields[1]!, display = end.querySelector('.timecode__display'); assert.ok(display);
			await act(async () => reactProps(display).onDoubleClick());
			const input = end.querySelector('input'); assert.ok(input);
			await act(async () => reactProps(input).onChange({ currentTarget: { value: '00:00:00.500' } }));
			await act(async () => reactProps(input).onKeyDown({ key: 'Enter', preventDefault() {}, stopPropagation() {} }));
			assert.deepEqual(selections, [[0, 24_000]]);
		} else assert.deepEqual(selections, []);
	} finally {
		await act(async () => root.unmount());
		globals.IS_REACT_ACT_ENVIRONMENT = priorAct; globals.React = priorReact;
		if (priorObserver) Object.defineProperty(globalThis, 'MutationObserver', priorObserver);
		else Reflect.deleteProperty(globalThis, 'MutationObserver');
		dom.restore();
	}
});
