/* SPDX-License-Identifier: AGPL-3.0-only */
import { strFromU8, unzipSync } from 'fflate';
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseExportProjectFileAction, disableNativeSavePicker, downloadBytes } from './audio-editor-test-helpers.js';
import { quickTimeMetadataPrecedenceFixture } from '../helpers/ordinary-tail-m4a-fixture.ts';

for (const legacyFirst of [true, false]) test(`File Import prefers modern metadata with legacy first=${legacyFirst}`, async ({ page }) => {
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/embed/en/');
	const file = await quickTimeMetadataPrecedenceFixture(legacyFirst);
	await editor.locator('[data-import-input]').setInputFiles({ name: file.name, mimeType: file.type, buffer: Buffer.from(await file.arrayBuffer()) });
	await expect(editor).toHaveAttribute('data-clip-count', '1', { timeout: 30_000 });
	const downloading = page.waitForEvent('download');
	await chooseExportProjectFileAction(page, editor);
	const document = JSON.parse(strFromU8(unzipSync(await downloadBytes(await downloading))['project.json']));
	const contribution = document.sources[0].provenance.contributions[0];
	expect(contribution.warnings).toEqual([]);
	expect(contribution.metadata.normalized).toMatchObject({ title: 'Two retained covers', album: 'Legacy album fallback', comment: 'After covers' });
	expect(contribution.metadata.raw['©nam']).toBe('Two retained covers');
	expect(contribution.attachments.filter(({ path }) => /^images\[/u.test(path))).toHaveLength(2);
});
