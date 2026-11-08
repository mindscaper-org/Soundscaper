/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor } from './audio-editor-test-helpers.js';

test('a continuous sound threshold drag persists its released value', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await editor.getByRole('button', { name: 'Record options', exact: true }).click();
	await page.getByRole('dialog', { name: 'Record options', exact: true })
		.getByRole('button', { name: 'Sound activation', exact: true }).click();
	const panel = page.locator('[data-sound-activation-settings]');
	const threshold = panel.getByRole('slider', { name: 'Activation threshold', exact: true });
	await expect(threshold).toBeEnabled();
	const box = await threshold.boundingBox();
	if (!box) throw new Error('Activation threshold is unavailable');
	const min = Number(await threshold.getAttribute('min'));
	const max = Number(await threshold.getAttribute('max'));
	const value = Number(await threshold.inputValue());
	const x = box.x + 8 + (box.width - 16) * (value - min) / (max - min);
	const y = box.y + box.height / 2;
	await page.mouse.move(x, y);
	await page.mouse.down();
	await page.mouse.move(box.x + box.width - 8, y, { steps: 10 });
	await page.mouse.up();
	await expect(threshold).toBeEnabled();
	await expect(panel).toHaveAttribute('data-sound-activation-pending', 'false');
	await expect(panel).toHaveAttribute('data-sound-activation-threshold-db', String(max));
	await expect(threshold).toHaveValue(String(max));
	const restored = await bootEditor(page, '/embed/en/');
	await restored.getByRole('button', { name: 'Record options', exact: true }).click();
	await page.getByRole('dialog', { name: 'Record options', exact: true })
		.getByRole('button', { name: 'Sound activation', exact: true }).click();
	await expect(page.getByRole('dialog', { name: 'Sound activation', exact: true })
		.getByRole('slider', { name: 'Activation threshold', exact: true })).toHaveValue(String(max));
});
