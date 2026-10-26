/* SPDX-License-Identifier: AGPL-3.0-only */
import { strFromU8, unzipSync } from 'fflate';
import { encodeAiff } from '../../src/common/editor/aiff.js';
import { encodeWav } from '../../src/common/editor/wav.js';
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, chooseExportProjectFileAction, disableNativeSavePicker, downloadBytes, importFiles } from './audio-editor-test-helpers.js';

for (const format of ['wav', 'aiff', 'aifc']) test(`imported ${format} descriptive fields appear in Attribution and native Save`, async ({ page }) => {
	const metadata = { title: 'Reviewed recording', artist: 'Ada', album: 'Field sessions', genre: 'Ambient',
		composer: 'Éva', copyright: '© 2026 Ada', publisher: 'Reviewed studio', track: '3/9', year: '2026' };
	const pcm = [new Float32Array(4800).fill(.25)];
	const options = { sampleRate: 48_000, bitDepth: 24, float: format === 'aifc', dither: false, metadata };
	const bytes = format === 'wav' ? encodeWav(pcm, options) : encodeAiff(pcm, options);
	await disableNativeSavePicker(page); const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [{ name: `Recording.${format}`, mimeType: format === 'wav' ? 'audio/wav' : 'audio/aiff', buffer: Buffer.from(bytes) }]);
	await expect(editor).not.toHaveAttribute('data-edit-block-reason', 'importing', { timeout: 30_000 });
	await chooseCommandAction(page, editor, 'Edit', 'Metadata editor');
	const panel = editor.locator('[data-workspace-panel="metadata"]');
	await panel.getByRole('tab', { name: 'Attribution', exact: true }).click();
	const attribution = panel.getByRole('tabpanel', { name: 'Attribution', exact: true });
	await attribution.getByText('Imported metadata', { exact: true }).click();
	for (const [key, value] of Object.entries({ album: metadata.album, genre: metadata.genre })) {
		const field = attribution.locator('dl > div').filter({ has: page.getByText(`normalized.${key}`, { exact: true }) });
		await expect(field).toContainText(value);
	}
	const downloading = page.waitForEvent('download'); await chooseExportProjectFileAction(page, editor);
	const project = JSON.parse(strFromU8(unzipSync(await downloadBytes(await downloading))['project.json']));
	const source = project.sources.find(source => source.name === `Recording.${format}`); expect(source).toMatchObject({ frameCount: 4800, sampleRate: 48_000 });
	expect(source.provenance.contributions[0].metadata.normalized).toMatchObject({ title: metadata.title, artist: metadata.artist,
		album: metadata.album, genre: metadata.genre, trackNumber: 3, tracksTotal: 9, date: '2026-01-01T00:00:00.000Z' });
});
