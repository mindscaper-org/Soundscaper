/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import EffectPresetBar from '../src/common/editor/ui/inspector/EffectPresetBar.jsx';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

test('preset import gives the picker a surviving focus return target before removing its menu', async () => {
	const dom = installReactTestDom();
	const root = createRoot(dom.container as unknown as HTMLElement);
	const globals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = globals.IS_REACT_ACT_ENVIRONMENT;
	const priorReact = Object.getOwnPropertyDescriptor(globalThis, 'React');
	globals.IS_REACT_ACT_ENVIRONMENT = true;
	Object.defineProperty(globalThis, 'React', { configurable: true, value: React });
	try {
		await act(async () => { root.render(<EffectPresetBar copy={ENGLISH_COPY} presets={[]}
			onSelect={() => undefined} onSave={() => undefined} onSaveAs={() => undefined}
			onReset={() => undefined} onDelete={() => undefined} onImport={() => undefined} onExport={() => undefined} />); });
		const more = dom.one(`[aria-label="${ENGLISH_COPY.moreOptions}"]`);
		await act(async () => { reactProps(more).onClick({ currentTarget: more }); });
		const item = dom.container.ownerDocument.body.querySelectorAll('[role="menuitem"]').find(node => node.textContent === ENGLISH_COPY.importEffectPreset);
		assert.ok(item);
		item.focus();
		let pickerOpened = false;
		let stableOpener = false;
		Object.defineProperty(dom.one('[data-effect-preset-file]'), 'click', { configurable: true, value() {
			pickerOpened = true;
			stableOpener = dom.container.ownerDocument.activeElement === more;
		} });
		await act(async () => { reactProps(item).onClick({}); });
		assert.equal(pickerOpened, true);
		assert.equal(stableOpener, true, 'native cancellation can return to the surviving preset options button');
		assert.equal(dom.container.ownerDocument.activeElement?.getAttribute('aria-label'), ENGLISH_COPY.moreOptions);
	} finally {
		await act(async () => { root.unmount(); });
		if (priorReact) Object.defineProperty(globalThis, 'React', priorReact);
		else Reflect.deleteProperty(globalThis, 'React');
		globals.IS_REACT_ACT_ENVIRONMENT = priorAct;
		dom.restore();
	}
});
