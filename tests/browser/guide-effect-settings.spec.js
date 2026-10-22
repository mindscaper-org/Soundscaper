/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { applyGuideEffectSetting } from './helpers/guide-effect-settings.js';

const original = '26.022720750706366';

for (const deferredDefault of [false, true]) test(`guide replaces a numeric value with a focus default update=${deferredDefault}`, async ({ page }) => {
	await page.setContent(`<div role="dialog" aria-label="Apply effect"><div role="group" aria-label="Amplification (dB)"><input type="number" min="-50" max="50" step="0.1" value="${original}"></div></div>`);
	if (deferredDefault) await page.evaluate(original => {
		const input = document.querySelector('input');
		input.addEventListener('focus', () => {
			// A controlled default can replace the selected text before native insertion.
			queueMicrotask(() => {
				input.value = '';
				input.value = original;
				input.dataset.defaultApplied = 'true';
			});
		}, { once: true });
	}, original);
	await applyGuideEffectSetting(page, page.getByRole('dialog', { name: 'Apply effect', exact: true }), { label: 'Amplification', value: '6' });
	await expect(page.getByRole('spinbutton')).toHaveValue('6');
	if (deferredDefault) await expect(page.getByRole('spinbutton')).toHaveAttribute('data-default-applied', 'true');
});
