/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Radio } from '../vendor/audacity-design-system/components/src/Radio/Radio.tsx';
import { Checkbox } from '../vendor/audacity-design-system/components/src/Checkbox/Checkbox.tsx';
import { ThemeProvider } from '../vendor/audacity-design-system/components/src/ThemeProvider/ThemeProvider.tsx';
import { lightTheme } from '../vendor/audacity-design-system/tokens/src/themes/light.v2.ts';
import { darkTheme } from '../vendor/audacity-design-system/tokens/src/themes/dark.v2.ts';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

for (const primitive of ['checkbox', 'radio'] as const) for (const owner of ['ctrlKey', 'metaKey', 'altKey', 'defaultPrevented', 'plain'] as const) {
	for (const key of ['Enter', ' ']) test(`${primitive} ${JSON.stringify(key)} respects keyboard ownership for ${owner}`, async () => {
		const dom = installReactTestDom();
		const globals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
		const prior = globals.IS_REACT_ACT_ENVIRONMENT;
		globals.IS_REACT_ACT_ENVIRONMENT = true;
		const root = createRoot(dom.container as unknown as Element);
		const changes: boolean[] = [];
		const Choice = primitive === 'checkbox' ? Checkbox : Radio;
		function View() {
			const [checked, setChecked] = useState(false);
			return <Choice checked={checked} aria-label="Snap" onChange={(next: boolean) => { changes.push(next); setChecked(next); }} />;
		}
		try {
			await act(async () => root.render(<View />));
			const checkbox = dom.one(`[role="${primitive}"]`);
			let prevented = false;
			await act(async () => reactProps(checkbox).onKeyDown({ key, [owner]: true,
				preventDefault() { prevented = true; } }));
			assert.equal(prevented, owner === 'plain');
			assert.deepEqual(changes, owner === 'plain' ? [true] : []);
			assert.equal(checkbox.getAttribute('aria-checked'), owner === 'plain' ? 'true' : 'false');
		} finally {
			await act(async () => root.unmount());
			globals.IS_REACT_ACT_ENVIRONMENT = prior;
			dom.restore();
		}
	});
}

for (const primitive of ['checkbox', 'radio'] as const) test(`${primitive} preserves every light and dark theme variable`, async () => {
	const dom = installReactTestDom();
	const globals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const prior = globals.IS_REACT_ACT_ENVIRONMENT;
	globals.IS_REACT_ACT_ENVIRONMENT = true;
	const root = createRoot(dom.container as unknown as Element);
	const Choice = primitive === 'checkbox' ? Checkbox : Radio;
	try {
		for (const theme of [lightTheme, darkTheme]) {
			await act(async () => root.render(<ThemeProvider theme={theme}><Choice checked disabled aria-label="Snap" /></ThemeProvider>));
			const choice = dom.one(`[role="${primitive}"]`);
			const expected = primitive === 'checkbox' ? {
				'--checkbox-bg-idle': theme.background.control.checkbox.idle,
				'--checkbox-bg-hover': theme.background.control.checkbox.hover,
				'--checkbox-bg-pressed': theme.background.control.checkbox.pressed,
				'--checkbox-icon-color': theme.foreground.icon.primary,
			} : {
				'--radio-border': theme.border.control.radio,
				'--radio-border-hover': theme.border.focus,
				'--radio-bg': theme.background.control.radio.idle,
				'--radio-pip': theme.background.control.button.primary.idle,
				'--radio-pip-disabled': theme.foreground.icon.disabled,
			};
			assert.deepEqual(Object.fromEntries(choice.style.values), expected);
			assert.equal(choice.getAttribute('aria-checked'), 'true');
		}
	} finally {
		await act(async () => root.unmount());
		globals.IS_REACT_ACT_ENVIRONMENT = prior;
		dom.restore();
	}
});

for (const primitive of ['checkbox', 'radio'] as const) for (const checked of [false, true]) {
	test(`${primitive} retains disabled and checked activation policy: checked=${checked}`, async () => {
		const dom = installReactTestDom();
		const globals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
		const prior = globals.IS_REACT_ACT_ENVIRONMENT;
		globals.IS_REACT_ACT_ENVIRONMENT = true;
		const root = createRoot(dom.container as unknown as Element);
		const changes: boolean[] = [];
		const Choice = primitive === 'checkbox' ? Checkbox : Radio;
		try {
			await act(async () => root.render(<Choice checked={checked} disabled={!checked}
				aria-label="Snap" onChange={(next: boolean) => { changes.push(next); }} />));
			let prevented = false;
			await act(async () => reactProps(dom.one(`[role="${primitive}"]`)).onKeyDown({ key: ' ',
				preventDefault() { prevented = true; } }));
			assert.equal(prevented, primitive === 'checkbox');
			assert.deepEqual(changes, primitive === 'checkbox' && checked ? [false] : []);
		} finally {
			await act(async () => root.unmount());
			globals.IS_REACT_ACT_ENVIRONMENT = prior;
			dom.restore();
		}
	});
}
