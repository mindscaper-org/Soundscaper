/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { ThemeProvider } from '@soundscaper/design-system/ThemeProvider';
import { OutputTrackNameEditor } from '../src/common/editor/ui/timeline/OutputTrackNameEditor.tsx';
import { installReactTestDom, reactProps, ReactTestElement } from './helpers/react-test-dom.ts';

for (const name of ['Opening\nRoom tone', 'Send bus 1']) test(`output rename preserves ${JSON.stringify(name)}`, async () => {
	const dom = installReactTestDom();
	const root = createRoot(dom.container as unknown as Element);
	const globals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const previousAct = globals.IS_REACT_ACT_ENVIRONMENT;
	globals.IS_REACT_ACT_ENVIRONMENT = true;
	const previousSelect = Object.getOwnPropertyDescriptor(ReactTestElement.prototype, 'select');
	Object.defineProperty(ReactTestElement.prototype, 'select', { configurable: true, value() {} });
	const commits: string[] = [];
	const closes: boolean[] = [];
	try {
		await act(async () => root.render(<ThemeProvider><OutputTrackNameEditor name={name} label="Track name"
			blocked={false} onCommit={value => commits.push(value)} onClose={restore => closes.push(restore)} /></ThemeProvider>));
		const multiline = name.includes('\n');
		const input = dom.one(multiline ? 'textarea' : 'input');
		assert.equal(input.ownerDocument.activeElement, input);
		if (!multiline) assert.equal(input.value, name);
		const label = dom.one('.audio-editor-output-name-editor');
		const key = async (value: string, shiftKey = false): Promise<boolean> => {
			let prevented = false;
			await act(async () => { reactProps(label).onKeyDown?.({ key: value, shiftKey, nativeEvent: { isComposing: false },
				preventDefault() { prevented = true; } }); });
			return prevented;
		};
		if (multiline) {
			assert.equal(await key('Enter', true), false, 'Shift+Enter retains native multiline editing');
			assert.deepEqual(closes, []);
		}
		await act(async () => { reactProps(input).onChange?.({ target: { value: `${name}!` } }); });
		assert.equal(await key('Enter'), true);
		assert.deepEqual(commits, [`${name}!`]);
		assert.deepEqual(closes, [true]);
	} finally {
		await act(async () => root.unmount());
		globals.IS_REACT_ACT_ENVIRONMENT = previousAct;
		if (previousSelect) Object.defineProperty(ReactTestElement.prototype, 'select', previousSelect);
		else Reflect.deleteProperty(ReactTestElement.prototype, 'select');
		dom.restore();
	}
});
