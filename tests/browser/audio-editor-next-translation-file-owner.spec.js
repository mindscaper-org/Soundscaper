/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction } from './audio-editor-test-helpers.js';
import { COMMUNITY_TRANSLATIONS_COPY_BY_LOCALE } from '../../src/common/i18n/community-translations-copy.ts';

test('an old translation-file refusal cannot appear after choosing another language', async ({ page }) => {
	await page.addInitScript(() => {
		const text = File.prototype.text;
		globalThis.__translationFileQueued = false;
		File.prototype.text = function () {
			if (this.name !== 'Old German.json') return text.call(this);
			globalThis.__translationFileQueued = true;
			return new Promise(resolve => { globalThis.__releaseTranslationFile = () => resolve('{'); });
		};
	});
	const copy = COMMUNITY_TRANSLATIONS_COPY_BY_LOCALE.en;
	const editor = await bootEditor(page, '/embed/en/');
	await chooseCommandAction(page, editor, 'Help', copy.menu);
	const surface = page.getByRole('dialog', { name: copy.title, exact: true });
	await expect(surface.getByRole('textbox', { name: copy.source, exact: true })).toBeVisible();
	await surface.getByLabel(copy.import, { exact: true }).setInputFiles({ name: 'Old German.json', mimeType: 'application/json', buffer: Buffer.from('{') });
	await expect.poll(() => page.evaluate(() => globalThis.__translationFileQueued)).toBe(true);
	await surface.getByRole('combobox', { name: copy.language, exact: true }).selectOption('fr');
	await expect(surface.getByRole('textbox', { name: copy.source, exact: true })).toBeVisible();
	await page.evaluate(() => globalThis.__releaseTranslationFile());
	await surface.getByRole('searchbox', { name: copy.search, exact: true }).fill('play');
	await expect(surface.getByRole('listbox', { name: new RegExp(`^${copy.messages} \\(`, 'u') }).locator('option[value="play"]')).toHaveCount(1);
	await expect(surface.getByRole('alert')).toHaveCount(0);
	await surface.getByLabel(copy.import, { exact: true }).setInputFiles({ name: 'Current French.json', mimeType: 'application/json', buffer: Buffer.from('{') });
	await expect(surface.getByRole('alert')).toContainText('JSON');
});
