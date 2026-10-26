/* SPDX-License-Identifier: AGPL-3.0-only */

import { strFromU8, unzipSync } from 'fflate';
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, downloadBytes } from './audio-editor-test-helpers.js';
import { COMMUNITY_TRANSLATIONS_COPY_BY_LOCALE } from '../../src/common/i18n/community-translations-copy.ts';

test('a JSON contribution keeps all note lines in its downloaded PO kit', async ({ page }) => {
	await page.addInitScript(() => Object.defineProperty(globalThis, 'showSaveFilePicker', { value: undefined, configurable: true }));
	const editor = await bootEditor(page, '/embed/en/'), copy = COMMUNITY_TRANSLATIONS_COPY_BY_LOCALE.en;
	await chooseCommandAction(page, editor, 'Help', copy.menu);
	const surface = page.getByRole('dialog', { name: copy.title, exact: true });
	await expect(surface.getByRole('textbox', { name: copy.source, exact: true })).toBeVisible();
	const first = page.waitForEvent('download');
	await surface.getByRole('button', { name: copy.po, exact: true }).click();
	const initial = unzipSync(await downloadBytes(await first)), manifest = JSON.parse(strFromU8(initial['manifest.json']));
	const incoming = { version: 1, locale: 'de', snapshotId: manifest.snapshotId, entries: [
		{ ...manifest.entries.play, translation: 'Wiedergabe beginnen', note: 'Verb\rButton label' },
	] };
	await surface.getByLabel(copy.import, { exact: true }).setInputFiles({ name: 'Reviewer notes.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(incoming)) });
	await expect(surface.getByRole('textbox', { name: copy.translation, exact: true })).toHaveValue('Wiedergabe beginnen');
	const second = page.waitForEvent('download');
	await surface.getByRole('button', { name: copy.po, exact: true }).click();
	const final = unzipSync(await downloadBytes(await second)), output = strFromU8(final['messages.po']);
	expect(output).toContain('# Verb\n# Button label\n');
	expect(output).not.toContain('Verb\rButton label');
});
