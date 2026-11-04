/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act, useState } from 'react';
import CustomToolbarActionPicker from '../src/common/editor/ui/dialogs/CustomToolbarActionPicker.tsx';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

test('action results open at three characters or fewer than ten matches, without choosing an action', async () => {
	const dom = installReactTestDom();
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
	actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	const actions = Array.from({ length: 12 }, (_, index) => ({
		actionId: `id-${index}`, label: `Action ${index}`, disabled: index === 0,
		path: [index < 9 ? `abc xy ${index}` : index === 9 ? 'abc' : 'a'],
	}));
	const selections: string[] = [];
	try {
		await act(async () => root.render(<CustomToolbarActionPicker actions={actions} actionId="" copy={ENGLISH_COPY}
			disabled={false} onSelect={(id) => { selections.push(id); }} />));
		const input = dom.one('[role="combobox"]');
		assert.equal(input.getAttribute('aria-expanded'), 'false');
		for (const [query, expanded, count] of [['a', false, 12], ['ab', false, 10], ['abc', true, 10], ['xy', true, 9], ['no match', true, 0]] as const) {
			await act(async () => { reactProps(input).onChange({ currentTarget: { value: query } }); });
			assert.equal(input.getAttribute('aria-expanded'), String(expanded), query);
			assert.equal(dom.container.querySelectorAll('[role="option"]').length, expanded ? count : 0, query);
		}
		assert.deepEqual(selections, ['', '', '', '', ''], 'typing requires an explicit new selection');
		assert.equal(dom.one('[role="status"]').textContent, ENGLISH_COPY.customToolbarButtonNoActions);
		await act(async () => { reactProps(dom.one('[aria-label="Show actions"]')).onClick(); });
		assert.equal(dom.container.querySelectorAll('[role="option"]').length, 0, 'the toggle can close the results');
		await act(async () => { reactProps(dom.one('[aria-label="Show actions"]')).onClick(); });
		assert.equal(dom.container.querySelectorAll('[role="option"]').length, 12);
		await act(async () => { reactProps(dom.container.querySelectorAll('[role="option"]')[0]!).onClick(); });
		assert.equal(selections.at(-1), 'id-0', 'unavailable commands remain assignable for future use');
		assert.equal(input.getAttribute('aria-expanded'), 'false');
	} finally {
		await act(async () => root.unmount());
		actGlobal.IS_REACT_ACT_ENVIRONMENT = priorAct;
		dom.restore();
	}
});

test('Escape cancels an action search and restores the existing custom-button action', async () => {
	const dom = installReactTestDom();
	const globals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const previousAct = globals.IS_REACT_ACT_ENVIRONMENT;
	globals.IS_REACT_ACT_ENVIRONMENT = true;
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	const actions = [{ actionId: 'undo', label: 'Undo', disabled: false, path: ['Edit', 'Undo'] },
		{ actionId: 'redo', label: 'Redo', disabled: false, path: ['Edit', 'Redo'] }];
	function Picker() {
		const [actionId, setActionId] = useState('undo');
		return <CustomToolbarActionPicker actions={actions} actionId={actionId} copy={ENGLISH_COPY} disabled={false} onSelect={setActionId} />;
	}
	try {
		await act(async () => root.render(<Picker />));
		const input = dom.one('[role="combobox"]');
		await act(async () => { reactProps(input).onChange?.({ currentTarget: { value: 'redo' } }); });
		await act(async () => { reactProps(dom.one('.kw-audio-editor-custom-button-dialog__action-picker')).onKeyDown?.({ key: 'Escape', target: input, nativeEvent: { isComposing: false }, preventDefault() {}, stopPropagation() {} }); });
		assert.equal(input.value, 'Edit › Undo');
		assert.equal(input.getAttribute('aria-expanded'), 'false');
	} finally {
		await act(async () => root.unmount());
		globals.IS_REACT_ACT_ENVIRONMENT = previousAct; dom.restore();
	}
});
