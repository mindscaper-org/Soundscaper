/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import AudioEditorButtonTooltips from '../src/common/editor/ui/AudioEditorButtonTooltips.jsx';
import { installReactTestDom } from './helpers/react-test-dom.ts';

(globalThis as typeof globalThis & { React: typeof React }).React = React;

test('an open button tooltip updates all bindings and removes cleared assignments without changing its accessible name', async () => {
	const dom = installReactTestDom();
	const globals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = globals.IS_REACT_ACT_ENVIRONMENT;
	globals.IS_REACT_ACT_ENVIRONMENT = true;
	const editor = dom.container as unknown as HTMLElement;
	const events = new EventTarget();
	editor.addEventListener = events.addEventListener.bind(events);
	editor.removeEventListener = events.removeEventListener.bind(events);
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(editor);
	const render = (keys: readonly string[]) => <><span data-action-id="split-tool"><button aria-label="Werkzeug zum Teilen" /></span>
		<AudioEditorButtonTooltips rootRef={{ current: editor }} shortcuts={{ 'split-tool': keys }} /></>;
	try {
		await act(async () => root.render(render(['C'])));
		const button = dom.one('button');
		button.getBoundingClientRect = () => ({ left: 100, right: 124, top: 100, bottom: 124, width: 24, height: 24 });
		const over = new Event('pointerover');
		Object.defineProperty(over, 'target', { value: button });
		await act(async () => { events.dispatchEvent(over); });
		assert.equal(dom.one('[role="tooltip"]').textContent, 'Werkzeug zum Teilen (C)');
		await act(async () => root.render(render(['Ctrl+Alt+9', 'Mouse4'])));
		assert.equal(dom.one('[role="tooltip"]').textContent, 'Werkzeug zum Teilen (Ctrl+Alt+9, Mouse4)');
		assert.equal(dom.one('[role="tooltip"]').getAttribute('aria-label'), 'Werkzeug zum Teilen (Ctrl+Alt+9, Mouse4)');
		assert.equal(button.getAttribute('aria-label'), 'Werkzeug zum Teilen');
		await act(async () => root.render(render([])));
		assert.equal(dom.one('[role="tooltip"]').textContent, 'Werkzeug zum Teilen');
	} finally {
		await act(async () => root.unmount());
		globals.IS_REACT_ACT_ENVIRONMENT = priorAct;
		dom.restore();
	}
});
