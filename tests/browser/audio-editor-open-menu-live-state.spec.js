/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor } from './audio-editor-test-helpers.js';
import { aacLcAdtsPceFixture } from '../helpers/os-audio-codec-fixtures.ts';

test('an Edit menu opened while importing enables Undo when import finishes', async ({ page }) => {
	await page.addInitScript(() => {
		const decode = BaseAudioContext.prototype.decodeAudioData;
		BaseAudioContext.prototype.decodeAudioData = function (...args) {
			const pending = Reflect.apply(decode, this, args);
			if (!window.__holdMenuDecode) return pending;
			window.__holdMenuDecode = false;
			return pending.then(decoded => new Promise(resolve => { window.__releaseMenuDecode = () => resolve(decoded); }));
		};
	});
	const editor = await bootEditor(page, '/embed/en/');
	await page.evaluate(() => { window.__holdMenuDecode = true; });
	await editor.locator('[data-import-input]').setInputFiles({ name: 'Pending.bin', mimeType: 'application/octet-stream', buffer: Buffer.from(aacLcAdtsPceFixture(false)) });
	try {
		await expect.poll(() => page.evaluate(() => typeof window.__releaseMenuDecode)).toBe('function');
		await editor.getByRole('menubar').getByRole('menuitem', { name: 'Edit', exact: true }).click();
		const menu = editor.locator('.kw-audio-editor__application-menu[role="menu"]');
		const undo = menu.getByRole('menuitem', { name: /^Undo(?=\s|$)/u });
		await expect(undo).toBeDisabled();
		await page.evaluate(() => window.__releaseMenuDecode());
		await expect(editor).toHaveAttribute('data-clip-count', '1');
		await expect(menu).toBeVisible();
		await expect(undo).toBeEnabled();
		await undo.click();
		await expect(editor).toHaveAttribute('data-clip-count', '0');
	} finally { await page.evaluate(() => window.__releaseMenuDecode?.()); }
});
