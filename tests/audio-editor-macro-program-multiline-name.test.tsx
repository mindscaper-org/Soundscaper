/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import MacroScriptEditor from '../src/common/editor/ui/inspector/MacroScriptEditor.jsx';
import { resolveMacroManagerCopy } from '../src/common/editor/ui/inspector/macro-manager-copy.ts';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

for (const original of ['Opening\nRoom tone', 'Single line']) test(`macro program name preserves ${JSON.stringify(original)} through native editing and program switching`, async () => {
	const dom = installReactTestDom();
	const root = createRoot(dom.container as unknown as HTMLElement);
	const globals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = globals.IS_REACT_ACT_ENVIRONMENT;
	const priorReact = Object.getOwnPropertyDescriptor(globalThis, 'React');
	globals.IS_REACT_ACT_ENVIRONMENT = true;
	Object.defineProperty(globalThis, 'React', { configurable: true, value: React });
	const names: string[] = [];
	function Fixture() {
		const [script, setScript] = useState({ id: 'first', name: original, source: '' });
		return <><MacroScriptEditor key={script.id} script={script} onChange={(next: typeof script) => { names.push(next.name); setScript(next); }}
			copy={resolveMacroManagerCopy('en')} log={[]} failure={null} running={false} onTrust={() => undefined} />
			<button data-switch onClick={() => setScript({ id: 'second', name: 'Second program', source: '' })}>Second program</button></>;
	}
	const nameField = () => {
		const label = dom.one('[data-macro-script]').querySelectorAll('label')[0]!;
		return { label, field: label.querySelector('input') ?? label.querySelector('textarea')! };
	};
	try {
		await act(async () => { root.render(<Fixture />); });
		const { label, field } = nameField();
		assert.equal(field.tagName, original.includes('\n') ? 'TEXTAREA' : 'INPUT');
		field.focus();
		await act(async () => { reactProps(field).onFocus?.({ currentTarget: field }); });
		if (original.includes('\n')) {
			let prevented = false;
			await act(async () => { reactProps(dom.one('[data-macro-name-input]')).onKeyDown?.({ key: 'Enter', shiftKey: true, nativeEvent: { isComposing: false },
				target: field, preventDefault() { prevented = true; }, stopPropagation() {} }); });
			assert.equal(prevented, false, 'Shift+Enter remains native multiline editing');
			assert.deepEqual(names, []);
		}
		for (const next of [`${original}!`, 'Plain name']) {
			await act(async () => { reactProps(field).onChange?.({ target: { value: next } }); });
			await act(async () => {
				let stopped = false;
				const event = { key: 'Enter', shiftKey: false, nativeEvent: { isComposing: false }, target: field,
					preventDefault() {}, stopPropagation() { stopped = true; } };
				reactProps(dom.one('[data-macro-name-input]')).onKeyDown?.(event);
				if (!stopped) reactProps(label).onKeyDown?.(event);
			});
			assert.equal(names.at(-1), next);
			assert.equal(nameField().field === field, true, 'editing a name keeps its focused native control');
			assert.equal(dom.container.ownerDocument.activeElement === field, true);
		}
		const switcher = dom.one('[data-switch]');
		switcher.focus();
		await act(async () => { reactProps(switcher).onClick?.({}); });
		assert.equal(nameField().field.tagName, 'INPUT');
		assert.equal(nameField().field.value, 'Second program');
		assert.equal(dom.container.ownerDocument.activeElement === switcher, true, 'switching programs retains the later selected focus');
	} finally {
		await act(async () => { root.unmount(); });
		if (priorReact) Object.defineProperty(globalThis, 'React', priorReact);
		else Reflect.deleteProperty(globalThis, 'React');
		globals.IS_REACT_ACT_ENVIRONMENT = priorAct;
		dom.restore();
	}
});
