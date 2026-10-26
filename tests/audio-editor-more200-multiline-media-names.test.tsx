/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import ProjectBinNameEditor from '../src/common/editor/ui/workspace/ProjectBinNameEditor.tsx';
import { ClipHeader } from '../vendor/audacity-design-system/components/src/ClipHeader/ClipHeader.tsx';
import { installReactTestDom, reactProps, ReactTestElement } from './helpers/react-test-dom.ts';

for (const original of ['Opening\nRoom tone', 'Single line']) {
	test(`inline media name keeps its existing keyboard contract for ${JSON.stringify(original)}`, async () => {
		const dom = installReactTestDom();
		const globals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
		const previous = globals.IS_REACT_ACT_ENVIRONMENT; globals.IS_REACT_ACT_ENVIRONMENT = true;
		const select = Object.getOwnPropertyDescriptor(ReactTestElement.prototype, 'select');
		Object.defineProperty(ReactTestElement.prototype, 'select', { configurable: true, value() {} });
		const root = createRoot(dom.container as unknown as Element), commits: string[] = [];
		try {
			await act(async () => root.render(<ClipHeader name={original} renameRequestId={1}
				onRename={name => { commits.push(name); }} />));
			const editor = dom.find('textarea') ?? dom.one('input');
			let prevented = false;
			await act(async () => { reactProps(editor).onKeyDown?.({ key: 'Enter', shiftKey: true, currentTarget: editor,
				nativeEvent: { isComposing: false }, preventDefault: () => { prevented = true; }, stopPropagation() {} }); });
			if (!original.includes('\n')) { assert.equal(prevented, true); assert.equal(dom.find('input'), null); return; }
			assert.equal(prevented, false, 'Shift+Enter must retain the multiline name editor');
			assert.equal(dom.find('textarea'), editor, 'the editing element must preserve native line breaks');
			assert.deepEqual(commits, []);
			editor.value = `${original}\nReview`;
			await act(async () => { reactProps(editor).onKeyDown?.({ key: 'Enter', shiftKey: false, currentTarget: editor,
				nativeEvent: { isComposing: false }, preventDefault() {}, stopPropagation() {} }); });
			assert.deepEqual(commits, [`${original}\nReview`]);
			assert.equal(dom.find('textarea'), null);
		} finally {
			await act(async () => root.unmount()); globals.IS_REACT_ACT_ENVIRONMENT = previous;
			if (select) Object.defineProperty(ReactTestElement.prototype, 'select', select); else Reflect.deleteProperty(ReactTestElement.prototype, 'select');
			dom.restore();
		}
	});
}


test('Project bin retains the native multiline name input and Shift+Enter editing', async () => {
	const dom = installReactTestDom(), globals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const previous = globals.IS_REACT_ACT_ENVIRONMENT; globals.IS_REACT_ACT_ENVIRONMENT = true;
	const root = createRoot(dom.container as unknown as Element), commits: string[] = [];
	try {
		await act(async () => root.render(<ProjectBinNameEditor clip={{ id: 'clip' }} name={'Opening\nRoom tone'}
			copy={{ projectBinRename: 'Rename clip' }} disabled={false} onCommit={name => { commits.push(name); }} />));
		const field = dom.one('textarea');
		let blurred = false;
		Object.defineProperty(field, 'blur', { configurable: true, value: () => { blurred = true; } });
		await act(async () => { reactProps(field).onKeyDown({ key: 'Enter', shiftKey: true,
			currentTarget: field, nativeEvent: { isComposing: false }, stopPropagation() {} }); });
		assert.equal(blurred, false); assert.equal(reactProps(field).value, 'Opening\nRoom tone'); assert.deepEqual(commits, []);
	} finally { await act(async () => root.unmount()); globals.IS_REACT_ACT_ENVIRONMENT = previous; dom.restore(); }
});
