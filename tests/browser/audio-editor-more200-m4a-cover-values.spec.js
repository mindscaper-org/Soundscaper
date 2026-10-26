/* SPDX-License-Identifier: AGPL-3.0-only */

import { createHash } from 'node:crypto';
import { strFromU8, unzipSync } from 'fflate';
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseExportProjectFileAction, disableNativeSavePicker, downloadBytes } from './audio-editor-test-helpers.js';
import { freeformM4aMetadataFixture, iTunesGenreM4aFixture, multiValueM4aArtworkFixture } from '../helpers/ordinary-tail-m4a-fixture.ts';

for (const grouped of [false, true]) test(`File Import preserves every M4A cover attachment; grouped=${grouped}`, async ({ page }) => {
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/embed/en/');
	const { file, images } = await multiValueM4aArtworkFixture(grouped);
	for (const image of images) {
		const dimensions = await page.evaluate(async ({ encoded, type }) => {
			const image = new Image(); image.src = `data:${type};base64,${encoded}`; await image.decode();
			return [image.naturalWidth, image.naturalHeight];
		}, { encoded: Buffer.from(image).toString('base64'), type: 'image/png' });
		expect(dimensions).toEqual([1, 1]);
	}
	await editor.locator('[data-import-input]').setInputFiles({ name: file.name, mimeType: file.type,
		buffer: Buffer.from(await file.arrayBuffer()) });
	await expect(editor).toHaveAttribute('data-clip-count', '1', { timeout: 30_000 });
	const downloading = page.waitForEvent('download');
	await chooseExportProjectFileAction(page, editor);
	const saved = await downloadBytes(await downloading);
	const document = JSON.parse(strFromU8(unzipSync(saved)['project.json']));
	expect(document.sources).toHaveLength(1);
	expect(document.sources[0].sampleRate).toBe(44_100);
	expect(document.sources[0].frameCount).toBeGreaterThan(2_000);
	const contribution = document.sources[0].provenance.contributions[0];
	expect(contribution.warnings).toEqual([]);
	expect(contribution.metadata.normalized.title).toBe('Two retained covers');
	expect(contribution.metadata.normalized.comment).toBe('After covers');
	const covers = contribution.attachments.filter(attachment => /^images\[\d+\]$/u.test(attachment.path));
	expect(covers.map(cover => cover.sha256)).toEqual(images.map(image => createHash('sha256').update(image).digest('hex')));
	expect(covers.map(cover => cover.mimeType)).toEqual(['image/png', 'image/png']);
});

for (const [genre, expected] of [[18, 'Rock'], ['Ambient', 'Ambient']]) {
	test(`File Import preserves the standard iTunes genre ${genre}`, async ({ page }) => {
		await disableNativeSavePicker(page);
		const editor = await bootEditor(page, '/embed/en/');
		const file = await iTunesGenreM4aFixture(genre);
		await editor.locator('[data-import-input]').setInputFiles({ name: file.name, mimeType: file.type,
			buffer: Buffer.from(await file.arrayBuffer()) });
		await expect(editor).toHaveAttribute('data-clip-count', '1', { timeout: 30_000 });
		const downloading = page.waitForEvent('download');
		await chooseExportProjectFileAction(page, editor);
		const document = JSON.parse(strFromU8(unzipSync(await downloadBytes(await downloading))['project.json']));
		const contribution = document.sources[0].provenance.contributions[0];
		expect(contribution.warnings).toEqual([]);
		expect(contribution.metadata.normalized.genre).toBe(expected);
		expect(document.sources[0].sampleRate).toBe(44_100);
		expect(document.sources[0].frameCount).toBeGreaterThan(2_000);
	});
}

test('File Import retains the namespaced custom credits in an ordinary M4A', async ({ page }) => {
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/embed/en/');
	const file = await freeformM4aMetadataFixture();
	await editor.locator('[data-import-input]').setInputFiles({ name: file.name, mimeType: file.type,
		buffer: Buffer.from(await file.arrayBuffer()) });
	await expect(editor).toHaveAttribute('data-clip-count', '1', { timeout: 30_000 });
	const downloading = page.waitForEvent('download');
	await chooseExportProjectFileAction(page, editor);
	const document = JSON.parse(strFromU8(unzipSync(await downloadBytes(await downloading))['project.json']));
	const contribution = document.sources[0].provenance.contributions[0];
	expect(contribution.warnings).toEqual([]);
	expect(contribution.metadata.raw['----:com.apple.iTunes:ENGINEER']).toBe('Hélène — reviewed credit');
	expect(contribution.metadata.raw['----:org.example.archive:ENGINEER']).toBe('Second namespace credit');
	expect(document.sources[0].sampleRate).toBe(44_100);
	expect(document.sources[0].frameCount).toBeGreaterThan(2_000);
});
