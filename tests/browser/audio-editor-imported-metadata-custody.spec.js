/* SPDX-License-Identifier: AGPL-3.0-only */

import { createHash } from 'node:crypto';
import { strFromU8, unzipSync } from 'fflate';
import { footerTaggedMp3Fixture, multilingualMp3Fixture } from '../helpers/ordinary-cover-mp3-fixture.ts';
import { quickTimeMetadataPrecedenceFixture } from '../helpers/ordinary-tail-m4a-fixture.ts';
import { expect, test } from './audio-editor-test-fixtures.js';
import {
	bootEditor, chooseExportProjectFileAction, disableNativeSavePicker, downloadBytes,
} from './audio-editor-test-helpers.js';

// Tag-layout variants and archive reopening are exercised in
// audio-editor-imported-metadata-scape-custody.test.ts. This batch retains the
// real browser decode, File Import and Save wiring for both containers.
test('File Import and Save retain MP3 and M4A metadata and binary attachment identities', async ({ page }) => {
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/embed/en/');
	const footer = await footerTaggedMp3Fixture(true);
	const multilingual = await multilingualMp3Fixture();
	const quickTime = await quickTimeMetadataPrecedenceFixture(true);
	const files = [footer, multilingual.file, quickTime];
	await editor.locator('[data-import-input]').setInputFiles(await Promise.all(files.map(async file => ({
		name: file.name, mimeType: file.type, buffer: Buffer.from(await file.arrayBuffer()),
	}))));
	await expect(editor).toHaveAttribute('data-clip-count', '3', { timeout: 30_000 });
	const downloading = page.waitForEvent('download');
	await chooseExportProjectFileAction(page, editor);
	const entries = unzipSync(await downloadBytes(await downloading));
	const document = JSON.parse(strFromU8(entries['project.json']));
	expect(document.sources).toHaveLength(3);
	for (const file of files) {
		const source = document.sources.find(source => source.name === file.name);
		expect(source, file.name).toBeDefined();
		expect(source.provenance.contributions).toHaveLength(1);
		const contribution = source.provenance.contributions[0];
		expect(contribution.origin).toMatchObject({ kind: 'local-file', originalFileName: file.name, byteLength: file.size });
		expect(contribution.warnings).toEqual([]);
		if (file === footer) {
			expect(source).toMatchObject({ sampleRate: 48_000, channelCount: 1 });
			expect(contribution.metadata.normalized).toMatchObject({ title: 'Footer title', artist: 'Footer performer' });
			expect(contribution.metadata.raw.TIT2).toBe('Footer title');
		} else if (file === multilingual.file) {
			expect(contribution.metadata.normalized.lyrics).toBe('First verse');
			for (const [key, payload] of Object.entries(multilingual.payloads)) {
				const path = `raw.${multilingual.records[key] ? `${key}.bytes` : key}`;
				expect(contribution.metadata.raw[key]).toEqual(multilingual.records[key] ?? { attachmentPath: path });
				expect(contribution.attachments.find(attachment => attachment.path === path)).toMatchObject({
					sha256: createHash('sha256').update(payload).digest('hex'), byteLength: payload.length,
				});
			}
		} else {
			expect(contribution.metadata.normalized).toMatchObject({
				title: 'Two retained covers', album: 'Legacy album fallback', comment: 'After covers',
			});
			expect(contribution.metadata.raw['©nam']).toBe('Two retained covers');
			expect(contribution.attachments.filter(({ path }) => /^images\[/u.test(path))).toHaveLength(2);
		}
	}
	await expect(editor.getByRole('progressbar', { name: 'Saving project', exact: true })).toBeHidden();
});
