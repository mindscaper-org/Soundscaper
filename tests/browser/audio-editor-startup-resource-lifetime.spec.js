/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor } from './audio-editor-test-helpers.js';

test('editor readiness does not wait for an unrelated page resource to finish loading', async ({ page }) => {
	let release;
	const pending = new Promise(resolve => { release = resolve; });
	await page.route('**/__pending-startup-image.png', async route => {
		await pending;
		await route.fulfill({ status: 204 });
	});
	await page.addInitScript(() => {
		document.addEventListener('DOMContentLoaded', () => {
			const image = new Image();
			image.hidden = true;
			image.src = '/__pending-startup-image.png';
			document.body.append(image);
		}, { once: true });
	});
	try {
		const editor = await bootEditor(page, '/embed/en/');
		const file = editor.getByRole('menuitem', { name: 'File', exact: true });
		await file.click();
		await expect(file).toHaveAttribute('aria-expanded', 'true');
		await page.keyboard.press('Escape');
		expect(await page.evaluate(() => ({ readyState: document.readyState,
			pendingImage: [...document.images].some(image => image.src.endsWith('/__pending-startup-image.png') && !image.complete),
		}))).toEqual({ readyState: 'interactive', pendingImage: true });
	} finally { release(); }
});
