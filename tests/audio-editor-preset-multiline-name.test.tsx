/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { validateDeliveryPreset } from '../src/common/editor/delivery-preset.ts';
import EffectPresetBar from '../src/common/editor/ui/inspector/EffectPresetBar.jsx';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

test('Save as retains an admitted multiline delivery preset label through its existing name prompt', async () => {
	const dom = installReactTestDom();
	const globals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const prior = globals.IS_REACT_ACT_ENVIRONMENT;
	const priorReact = Object.getOwnPropertyDescriptor(globalThis, 'React');
	globals.IS_REACT_ACT_ENVIRONMENT = true;
	Object.defineProperty(globalThis, 'React', { configurable: true, value: React });
	const root = createRoot(dom.container as unknown as Element);
	const original = 'Opening\nRoom tone';
	const preset = validateDeliveryPreset({ schemaVersion: 1, id: 'room', label: original, kind: 'audio', format: 'wav', settings: {} });
	const saved: string[] = [];
	try {
		await act(async () => root.render(<EffectPresetBar copy={ENGLISH_COPY}
			presets={[{ id: preset.id, label: preset.label, custom: true }]} selectedId={preset.id}
			onSelect={() => undefined} onSave={() => undefined} onSaveAs={(name: string) => { saved.push(name); }}
			onReset={() => undefined} onDelete={() => undefined} onImport={() => undefined} onExport={() => undefined} />));
		const trigger = dom.one(`[aria-label="${ENGLISH_COPY.saveEffectPreset}"]`);
		await act(async () => reactProps(trigger).onClick({ currentTarget: trigger }));
		const item = dom.container.ownerDocument.body.querySelectorAll('[role="menuitem"]').find(node => node.textContent === ENGLISH_COPY.saveEffectPresetAs);
		assert.ok(item);
		await act(async () => reactProps(item).onClick({ stopPropagation() {} }));
		const field = dom.container.ownerDocument.body.querySelector('textarea');
		assert.ok(field, 'an admitted line break needs the native multiline control in this existing prompt');
		await act(async () => reactProps(field).onChange({ target: { value: 'Plain' } }));
		assert.strictEqual(dom.container.ownerDocument.body.querySelector('textarea'), field, 'changing text retains its native editing owner');
		await act(async () => reactProps(field).onChange({ target: { value: `${original}!` } }));
		const form = dom.container.ownerDocument.body.querySelector('form');
		assert.ok(form);
		await act(async () => reactProps(form).onSubmit({ preventDefault() {} }));
		assert.deepEqual(saved, [`${original}!`]);
	} finally {
		await act(async () => root.unmount());
		globals.IS_REACT_ACT_ENVIRONMENT = prior;
		if (priorReact) Object.defineProperty(globalThis, 'React', priorReact);
		else Reflect.deleteProperty(globalThis, 'React');
		dom.restore();
	}
});
