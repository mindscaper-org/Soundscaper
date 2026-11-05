/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';

import { ShortcutEditorRow } from '../src/common/editor/ui/dialogs/ShortcutEditorRow.tsx';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

for (const moveFocus of [false, true]) {
	test(`shortcut assignment ${moveFocus ? 'preserves a later chosen control' : 'returns focus to its binding after Assign becomes disabled'}`, async () => {
		const dom = installReactTestDom();
		const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
		const priorAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
		const priorReact = Object.getOwnPropertyDescriptor(globalThis, 'React');
		actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
		Object.defineProperty(globalThis, 'React', { configurable: true, value: React });
		const { createRoot } = await import('react-dom/client');
		const root = createRoot(dom.container as unknown as Element);
		const requests: { id: string; bindings: string[] }[] = [];
		let finishSave: (() => void) | undefined;
		const save = new Promise<void>((resolve) => { finishSave = resolve; });
		const render = (bindings: readonly string[]) => <>
			<ShortcutEditorRow
				command={{ id: 'new-label-track', label: 'New label track' }}
				preferences={{ shortcuts: { 'new-label-track': bindings } }}
				controller={{ actions: { preferences: { setShortcut: (id, next) => {
					requests.push({ id, bindings: next });
					return save;
				} } } }}
				copy={{ shortcutAssign: 'Assign', shortcutColumn: 'Shortcut', shortcutAddBinding: 'Add', shortcutRemoveBinding: 'Remove' }}
				run={(operation) => operation()}
			/>
			<button data-next-control>Next command</button>
		</>;
		try {
			await act(async () => root.render(render([])));
			const field = dom.one('[data-shortcut-binding="0"]');
			await act(async () => { reactProps(field).onChange?.({ currentTarget: { value: 'Ctrl+Shift+%' } }); });
			const assign = [...dom.container.querySelectorAll('button')].find((button) => button.textContent === 'Assign');
			assert.ok(assign);
			assign.focus();
			await act(async () => { void reactProps(assign).onClick?.({ currentTarget: assign }); });
			assert.deepEqual(requests, [{ id: 'new-label-track', bindings: ['Ctrl+Shift+%'] }]);
			const next = dom.one('[data-next-control]');
			if (moveFocus) next.focus();
			else dom.container.ownerDocument.body.focus(); // Native disabled buttons lose focus during commit.
			await act(async () => {
				finishSave?.();
				await save;
				root.render(render(['Ctrl+Shift+%']));
			});
			assert.ok(assign.hasAttribute('disabled'));
			const active = dom.container.ownerDocument.activeElement;
			assert.equal(active?.getAttribute(moveFocus ? 'data-next-control' : 'data-shortcut-binding'), moveFocus ? 'true' : '0');
		} finally {
			finishSave?.();
			await act(async () => root.unmount());
			actGlobal.IS_REACT_ACT_ENVIRONMENT = priorAct;
			if (priorReact) Object.defineProperty(globalThis, 'React', priorReact);
			else Reflect.deleteProperty(globalThis, 'React');
			dom.restore();
		}
	});
}
