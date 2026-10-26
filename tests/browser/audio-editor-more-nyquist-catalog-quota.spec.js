/* SPDX-License-Identifier: AGPL-3.0-only */

import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, openNestedCommandMenu } from './audio-editor-test-helpers.js';
import { registerNyquistArchivePublication } from './helpers/nyquist-archive-publication.js';

test('Get effects can remove an earlier installed plug-in when its optional catalog metadata cannot be saved', async ({ page }) => {
	const source = gunzipSync(readFileSync(new URL('../fixtures/nyquist-archive/HQ-Tone.ny.gz', import.meta.url))).toString('utf8');
	await page.addInitScript(installedSource => {
		const key = 'soundscaper-nyquist-archive-plugins-v1';
		// Persisted record emitted by the original installer, before catalog metadata existed.
		localStorage.setItem(key, JSON.stringify([{
			id: 'nyquist:archive:HQ-Tone.ny', fileName: 'HQ-Tone.ny', source: installedSource,
			archiveId: 'audacityteam-nyquist-plugins-ed168a19631ec48d0029dfb5c17d16c339a174c1',
			name: 'HQ-Tone', role: 'generate', spectral: false,
		}]));
		const write = Storage.prototype.setItem;
		Storage.prototype.setItem = function (name, value) {
			if (name === key && value.includes('catalogTitle')) {
				throw new DOMException('Storage quota exceeded.', 'QuotaExceededError');
			}
			return write.call(this, name, value);
		};
	}, source);
	await registerNyquistArchivePublication(page, ['HQ-Tone.ny']);
	const editor = await bootEditor(page, '/embed/en/');
	const menu = await openNestedCommandMenu(page, editor, 'Effect', ['Nyquist']);
	await menu.getByRole('menuitem', { name: 'Get effects', exact: true }).click();
	const catalog = page.getByRole('dialog', { name: 'Get effects', exact: true });
	await catalog.getByRole('searchbox', { name: 'Search effects' }).fill('HQ-Tone');
	await catalog.getByRole('button', { name: 'Remove HQ-Tone', exact: true }).click();
	await expect(catalog.getByRole('button', { name: 'Install HQ-Tone', exact: true })).toBeVisible();
	expect(await page.evaluate(() => JSON.parse(localStorage.getItem('soundscaper-nyquist-archive-plugins-v1')))).toEqual([]);
});
