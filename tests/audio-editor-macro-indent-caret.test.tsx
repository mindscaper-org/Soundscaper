/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import MacroScriptEditor from '../src/common/editor/ui/inspector/MacroScriptEditor.jsx';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

test('macro indentation leaves a later typed caret intact', async () => {
	const dom = installReactTestDom();
	const globals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean; React?: typeof React };
	const priorAct = globals.IS_REACT_ACT_ENVIRONMENT, priorReact = globals.React;
	globals.IS_REACT_ACT_ENVIRONMENT = true; globals.React = React;
	const frames: FrameRequestCallback[] = [];
	globalThis.requestAnimationFrame = cb => { frames.push(cb); return frames.length; };
	const root = createRoot(dom.container as unknown as Element);
	function Fixture() {
		const [script, setScript] = useState({ id: 'script', name: 'Program', source: '' });
		return <MacroScriptEditor copy={{}} script={script} log={[]} failure={null} running={false} onChange={setScript} />;
	}
	try {
		await act(async () => root.render(<Fixture />));
		const field = dom.one('[data-macro-script-source]');
		field.focus(); Object.assign(field, { selectionStart: 0, selectionEnd: 0 });
		await act(async () => reactProps(field).onKeyDown({ key: 'Tab', currentTarget: field, preventDefault() {} }));
		assert.equal(field.value, '  ');
		await act(async () => reactProps(field).onChange({ target: { value: '  f' } }));
		Object.assign(field, { selectionStart: 3, selectionEnd: 3 });
		await act(async () => { for (const cb of frames.splice(0)) cb(0); });
		assert.equal(Reflect.get(field, 'selectionStart'), 3);
		Object.assign(field, { selectionStart: 2, selectionEnd: 2 });
		await act(async () => reactProps(field).onKeyDown({ key: 'Tab', currentTarget: field, preventDefault() {} }));
		assert.equal(field.value, '    f');
		assert.equal(Reflect.get(field, 'selectionStart'), 4, 'indentation moves the caret before another key can arrive');
	} finally {
		await act(async () => root.unmount()); globals.IS_REACT_ACT_ENVIRONMENT = priorAct; globals.React = priorReact; dom.restore();
	}
});
