/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor } from './audio-editor-test-helpers.js';

test('the meter settings trigger closes its open flyout on the second click', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	const trigger = editor.getByRole('button', { name: 'Playback meter settings', exact: true });
	const settings = editor.getByRole('dialog', { name: 'Playback meter settings', exact: true });
	await trigger.click();
	await expect(settings).toBeVisible();
	await trigger.click();
	await expect(settings).toHaveCount(0);
	await expect(trigger).toHaveAttribute('aria-expanded', 'false');
});

test('the existing Play options trigger still closes its open flyout', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	const trigger = editor.getByRole('button', { name: 'Play options', exact: true });
	const options = editor.getByRole('menu', { name: 'Play options', exact: true });
	await trigger.click();
	await expect(options).toBeVisible();
	await trigger.click();
	await expect(options).toHaveCount(0);
});
