/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import EditorDialogNameField from '../src/common/editor/ui/dialogs/EditorDialogNameField.tsx';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

for (const value of ['Opening\nRoom tone', 'Single line']) test(`Rename keeps the native name entry contract for ${JSON.stringify(value)}`, async () => {
	const dom = installReactTestDom(), actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const previous = actGlobal.IS_REACT_ACT_ENVIRONMENT; actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	const root = createRoot(dom.container as unknown as Element), changes: string[] = [];
	let submitted = 0;
	try {
		await act(async () => root.render(<EditorDialogNameField value={value} onChange={next => { changes.push(next); }} onSubmit={() => { submitted++; }} />));
		const field = dom.one(value.includes('\n') ? 'textarea' : 'input');
		assert.equal(reactProps(field).value, value);
		if (!value.includes('\n')) return;
		const owner = dom.one('span'); let prevented = false;
		for (const keys of [{ shiftKey: true, isComposing: false }, { shiftKey: false, isComposing: true }]) {
			await act(async () => { reactProps(owner).onKeyDown({ key: 'Enter', shiftKey: keys.shiftKey,
				nativeEvent: { isComposing: keys.isComposing }, preventDefault() { prevented = true; }, stopPropagation() {} }); });
		}
		assert.equal(prevented, false); assert.equal(submitted, 0);
		await act(async () => { reactProps(field).onChange({ target: { value: `${value}!` } }); });
		assert.deepEqual(changes, [`${value}!`]);
		await act(async () => { reactProps(owner).onKeyDown({ key: 'Enter', shiftKey: false,
				nativeEvent: { isComposing: false }, preventDefault() { prevented = true; }, stopPropagation() {} }); });
		assert.equal(prevented, true); assert.equal(submitted, 1);
		await act(async () => root.render(<EditorDialogNameField value="Now one line" onChange={() => {}} onSubmit={() => {}} />));
		assert.ok(dom.find('textarea'), 'deleting a line break must not replace the focused editing element');
	} finally { await act(async () => root.unmount()); actGlobal.IS_REACT_ACT_ENVIRONMENT = previous; dom.restore(); }
});
