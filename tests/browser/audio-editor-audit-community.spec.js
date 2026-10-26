/* SPDX-License-Identifier: AGPL-3.0-only */
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, downloadBytes } from './audio-editor-test-helpers.js';
import { COMMUNITY_TRANSLATIONS_COPY_BY_LOCALE } from '../../src/common/i18n/community-translations-copy.ts';

const copy = COMMUNITY_TRANSLATIONS_COPY_BY_LOCALE.en;

test('optional message owners are editable and contributor typing is persisted once before export and close', async ({ page }) => {
	await page.addInitScript(() => {
		Object.defineProperty(globalThis, 'showSaveFilePicker', { value: undefined, configurable: true });
		const original = Storage.prototype.setItem;
		globalThis.__communityWrites = 0;
		Storage.prototype.setItem = function (key, value) {
			if (key.startsWith('soundscaper-community-translations-v1:')) globalThis.__communityWrites++;
			return original.call(this, key, value);
		};
	});
	const editor = await bootEditor(page, '/embed/en/');
	await chooseCommandAction(page, editor, 'Help', copy.menu);
	let surface = page.getByRole('dialog', { name: copy.title, exact: true });
	for (const [key, owner] of [['ui.audiocom.searchLabel', 'audiocom'], ['ui.freesoundAttribution.panel', 'freesoundAttribution'], ['ui.nyquistBundled.', 'nyquistBundled']]) {
		await surface.getByRole('searchbox', { name: copy.search, exact: true }).fill(key);
		const list = surface.getByRole('listbox');
		if (owner === 'nyquistBundled') {
			await list.selectOption({ index: 0 });
		} else await list.selectOption(key);
		await expect(surface.locator('dd').first()).toHaveText(owner);
		await expect(surface.getByRole('button', { name: copy.save, exact: true })).toBeEnabled();
	}
	const contributor = surface.getByRole('textbox', { name: copy.contributor, exact: true });
	await contributor.pressSequentially('Jane Doe');
	expect(await page.evaluate(() => globalThis.__communityWrites)).toBe(0);
	const download = page.waitForEvent('download');
	await surface.getByRole('button', { name: copy.export, exact: true }).click();
	const json = JSON.parse(new TextDecoder().decode(await downloadBytes(await download)));
	expect(json.contributor).toBe('Jane Doe');
	expect(await page.evaluate(() => globalThis.__communityWrites)).toBe(1);
	await contributor.fill('Jane Doe Jr');
	await contributor.press('Escape');
	await expect(surface).toHaveCount(0);
	await chooseCommandAction(page, editor, 'Help', copy.menu);
	surface = page.getByRole('dialog', { name: copy.title, exact: true });
	await expect(surface.getByRole('textbox', { name: copy.contributor, exact: true })).toHaveValue('Jane Doe Jr');
	expect(await page.evaluate(() => globalThis.__communityWrites)).toBe(2);
});
