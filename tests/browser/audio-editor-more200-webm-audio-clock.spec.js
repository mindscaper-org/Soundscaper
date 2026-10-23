/* SPDX-License-Identifier: AGPL-3.0-only */

import { strFromU8, unzipSync } from 'fflate';
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseExportProjectFileAction, disableNativeSavePicker, downloadBytes } from './audio-editor-test-helpers.js';
import { ordinaryWebmOpusFixture, taggedWebmOpusFixture } from '../helpers/ordinary-ogg-opus-fixture.ts';

for (const extension of ['webm', 'mka']) test(`File Import preserves the native 48 kHz Opus clock in audio-only ${extension}`, async ({ page }) => {
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/embed/en/');
	const file = await ordinaryWebmOpusFixture(extension);
	await editor.locator('[data-import-input]').setInputFiles({ name: file.name, mimeType: file.type,
		buffer: Buffer.from(await file.arrayBuffer()) });
	await expect(editor).toHaveAttribute('data-clip-count', '1', { timeout: 30_000 });
	const downloading = page.waitForEvent('download');
	await chooseExportProjectFileAction(page, editor);
	const document = JSON.parse(strFromU8(unzipSync(await downloadBytes(await downloading))['project.json']));
	expect(document.sources).toHaveLength(1);
	expect(document.sources[0].sampleRate).toBe(48_000);
	expect(document.sources[0].channelCount).toBe(1);
	expect(document.sources[0].frameCount).toBeGreaterThan(24_000);
});

for (const target of ['global', 'all-tracks']) test(`File Import retains WebM ${target} title and artist metadata`, async ({ page }) => {
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/embed/en/');
	const file = await taggedWebmOpusFixture(target);
	await editor.locator('[data-import-input]').setInputFiles({ name: file.name, mimeType: file.type,
		buffer: Buffer.from(await file.arrayBuffer()) });
	await expect(editor).toHaveAttribute('data-clip-count', '1', { timeout: 30_000 });
	const downloading = page.waitForEvent('download');
	await chooseExportProjectFileAction(page, editor);
	const document = JSON.parse(strFromU8(unzipSync(await downloadBytes(await downloading))['project.json']));
	const contribution = document.sources[0].provenance.contributions[0];
	expect(contribution.warnings).toEqual([]);
	expect(contribution.metadata.normalized.title).toBe('Authored global title');
	expect(contribution.metadata.normalized.artist).toBe('Ada — reviewed credit');
	expect(document.sources[0].sampleRate).toBe(48_000);
});
