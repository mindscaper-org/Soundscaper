/* SPDX-License-Identifier: AGPL-3.0-only */

import { EDITOR_ENGLISH_COPY } from '../../src/common/i18n/editor-copy-inventory.ts';
import { createPngFixture } from '../helpers/png-fixture.mjs';
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseNestedCommandAction } from './audio-editor-test-helpers.js';

// Keep all three pointer releases inside the browser viewport.
test.use({ viewport: { width: 1920, height: 1080 } });

test('an ordinary image can restore its original head after trimming into the held tail', async ({ page }) => {
	const editor = await bootEditor(page, '/framescaper/embed/en/');
	const chooser = page.waitForEvent('filechooser');
	await chooseNestedCommandAction(page, editor, 'Generate', [EDITOR_ENGLISH_COPY['ui.framescaperMenus.addVideoStill']]);
	await (await chooser).setFiles({ name: 'poster.png', mimeType: 'image/png', buffer: createPngFixture(16) });
	const clip = editor.getByRole('group', { name: 'Image clip: poster', exact: true });
	await expect(clip).toBeVisible();
	await expect(editor).not.toHaveAttribute('data-edit-block-reason', /.+/u);
	await clip.focus();
	await expect(clip).toBeFocused();
	await clip.press('Enter');
	await expect(clip.locator('.clip-display')).toHaveClass(/clip-display--selected/u);
	const initial = await clip.boundingBox(); expect(initial).not.toBeNull();
	const drag = async (edge, toX) => {
		const handle = clip.getByRole('button', { name: `Trim ${edge} edge`, exact: true });
		const box = await handle.boundingBox(); expect(box).not.toBeNull();
		const y = box.y + box.height / 2;
		await page.mouse.move(box.x + box.width / 2, y); await page.mouse.down();
		await page.mouse.move(toX, y, { steps: 12 }); await page.mouse.up();
	};
	await drag('right', initial.x + initial.width * 1.6);
	await expect.poll(async () => (await clip.boundingBox())?.width).toBeGreaterThan(initial.width * 1.5);
	await drag('left', initial.x + initial.width * 1.2);
	await expect.poll(async () => (await clip.boundingBox())?.x).toBeGreaterThan(initial.x + initial.width);
	await drag('left', initial.x);
	await expect.poll(async () => (await clip.boundingBox())?.x).toBeLessThan(initial.x + 2);
});
