/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import AudioEditorSearch from '../src/common/editor/ui/AudioEditorSearch.jsx';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

const Search = AudioEditorSearch as unknown as React.ComponentType<Record<string, unknown>>;

test('a retired Search opening frame leaves focus on the outside control', async () => {
	const dom = installReactTestDom();
	const globals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean; React?: typeof React };
	const priorAct = globals.IS_REACT_ACT_ENVIRONMENT;
	const priorReact = globals.React;
	globals.IS_REACT_ACT_ENVIRONMENT = true;
	globals.React = React;
	const frames: FrameRequestCallback[] = [];
	globalThis.requestAnimationFrame = callback => { frames.push(callback); return frames.length; };
	const events = new EventTarget();
	document.addEventListener = events.addEventListener.bind(events);
	document.removeEventListener = events.removeEventListener.bind(events);
	const root = createRoot(dom.container as unknown as Element);
	function Fixture() {
		const [open, setOpen] = useState(false);
		return <><button data-outside>File</button><Search copy={{}} locale="en" open={open} onOpenChange={setOpen} entries={[]} /></>;
	}
	try {
		await act(async () => root.render(<Fixture />));
		const outside = dom.one('[data-outside]');
		outside.focus();
		await act(async () => { reactProps(dom.one('[data-editor-search-trigger]')).onClick?.({ currentTarget: outside }); });
		assert.equal(dom.one('[data-editor-search]').getAttribute('data-editor-search-open'), 'true');
		const press = new Event('pointerdown');
		Object.defineProperty(press, 'target', { value: outside });
		await act(async () => { events.dispatchEvent(press); });
		assert.equal(dom.one('[data-editor-search]').getAttribute('data-editor-search-open'), 'false');
		await act(async () => { for (const frame of frames.splice(0)) frame(0); });
		assert.strictEqual(dom.container.ownerDocument.activeElement, outside);
	} finally {
		await act(async () => root.unmount());
		globals.IS_REACT_ACT_ENVIRONMENT = priorAct;
		globals.React = priorReact;
		dom.restore();
	}
});
