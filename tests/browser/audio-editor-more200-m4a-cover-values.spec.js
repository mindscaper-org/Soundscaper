/* SPDX-License-Identifier: AGPL-3.0-only */

import { createHash } from 'node:crypto';
import { strFromU8, unzipSync } from 'fflate';
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseExportProjectFileAction, chooseFileAction, disableNativeSavePicker, downloadBytes } from './audio-editor-test-helpers.js';
import { freeformM4aMetadataFixture, iTunesGenreM4aFixture, multiValueM4aArtworkFixture } from '../helpers/ordinary-tail-m4a-fixture.ts';

// Exact metadata/attachment matrices cross attribution and fresh Scape reopening
// in Node. Keep every original native AAC decode in one File Import/Save batch.
test('File Import and Save retain native M4A covers, genres and namespaced credits', async ({ page }) => {
	test.setTimeout(test.info().timeout * 3);
	const fixtures = [];
	for (const grouped of [false, true]) {
		const { file, images } = await multiValueM4aArtworkFixture(grouped);
		fixtures.push({ name: `covers-${grouped}.m4a`, file, images, genre: null, custom: false });
	}
	for (const [genre, expected] of [[18, 'Rock'], ['Ambient', 'Ambient']]) {
		fixtures.push({ name: `genre-${genre}.m4a`, file: await iTunesGenreM4aFixture(genre), images: null, genre: expected, custom: false });
	}
	fixtures.push({ name: 'custom.m4a', file: await freeformM4aMetadataFixture(), images: null, genre: null, custom: true });
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/embed/en/');
	for (const fixture of fixtures) for (const image of fixture.images ?? []) {
		const dimensions = await page.evaluate(async encoded => {
			const image = new Image(); image.src = `data:image/png;base64,${encoded}`; await image.decode();
			return [image.naturalWidth, image.naturalHeight];
		}, Buffer.from(image).toString('base64'));
		expect(dimensions).toEqual([1, 1]);
	}
	const files = await Promise.all(fixtures.map(async ({ name, file }) => ({ name, mimeType: file.type, buffer: Buffer.from(await file.arrayBuffer()) })));
	const choosing = page.waitForEvent('filechooser'); await chooseFileAction(page, editor, 'Import');
	await (await choosing).setFiles(files);
	await expect(editor).toHaveAttribute('data-clip-count', String(fixtures.length), { timeout: 30_000 });
	await expect(editor).not.toHaveAttribute('data-edit-block-reason', 'importing');
	const downloading = page.waitForEvent('download'); await chooseExportProjectFileAction(page, editor);
	const download = await downloading;
	let entries;
	try { entries = unzipSync(await downloadBytes(download)); } finally { await download.delete(); }
	const document = JSON.parse(strFromU8(entries['project.json']));
	expect(document.sources).toHaveLength(fixtures.length);
	for (const fixture of fixtures) {
		const source = document.sources.find(source => source.name === fixture.name);
		expect(source.sampleRate).toBe(44_100); expect(source.frameCount).toBeGreaterThan(2000);
		const contribution = source.provenance.contributions[0];
		expect(contribution.warnings).toEqual([]);
		if (fixture.images) {
			expect(contribution.metadata.normalized.title).toBe('Two retained covers');
			expect(contribution.metadata.normalized.comment).toBe('After covers');
			const covers = contribution.attachments.filter(attachment => /^images\[\d+\]$/u.test(attachment.path));
			expect(covers.map(cover => cover.sha256)).toEqual(fixture.images.map(image => createHash('sha256').update(image).digest('hex')));
			expect(covers.map(cover => cover.mimeType)).toEqual(['image/png', 'image/png']);
		}
		if (fixture.genre) expect(contribution.metadata.normalized.genre).toBe(fixture.genre);
		if (fixture.custom) {
			expect(contribution.metadata.raw['----:com.apple.iTunes:ENGINEER']).toBe('Hélène — reviewed credit');
			expect(contribution.metadata.raw['----:org.example.archive:ENGINEER']).toBe('Second namespace credit');
		}
	}
});
