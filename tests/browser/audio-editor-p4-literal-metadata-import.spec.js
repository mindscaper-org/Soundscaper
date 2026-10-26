/* SPDX-License-Identifier: AGPL-3.0-only */
import { readFile } from 'node:fs/promises';
import { strFromU8, unzipSync } from 'fflate';
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseExportProjectFileAction, disableNativeSavePicker, downloadBytes, sourcePeakChannels, waitForEditor } from './audio-editor-test-helpers.js';
import { parseScapeProjectDocument } from '../../src/common/editor/scape-project-document.ts';

for (const key of ['$soundscaperOpaqueBinary', 'OrdinaryCredit']) test(`File Import preserves literal TXXX name ${key} through Save and reload`, async ({ page }) => {
	test.setTimeout(60_000);
	const audio = Buffer.from(await readFile(new URL('../fixtures/ffmpeg-libmp3lame-one-second.mp3.base64', import.meta.url), 'utf8'), 'base64');
	// ID3v2.4 TXXX is UTF-8 encoding byte, arbitrary description, NUL, then value.
	// Both lengths stay below128, so the synchsafe fields use their final byte.
	const payload = Buffer.from(`\x03${key}\0Reviewed credit`, 'utf8');
	const frame = Buffer.alloc(10); frame.write('TXXX'); frame[7] = payload.length;
	const header = Buffer.from([73, 68, 51, 4, 0, 0, 0, 0, 0, 10 + payload.length]);
	const tag = Buffer.concat([header, frame, payload]);
	await disableNativeSavePicker(page);
	let editor = await bootEditor(page, '/embed/en/', { defaultWorkspace: true });
	await editor.locator('[data-import-input]').setInputFiles({ name: 'Credits.mp3', mimeType: 'audio/mpeg', buffer: Buffer.concat([tag, audio]) });
	await expect(editor).toHaveAttribute('data-clip-count', '1', { timeout: 20_000 });
	const peaks = await sourcePeakChannels(page, 'Credits.mp3'); expect(peaks.channels[0].maximum).toBeGreaterThan(.05);
	for (const reload of [false, true]) {
		if (reload) { await page.reload(); editor = await waitForEditor(page); }
		await expect(editor).toHaveAttribute('data-clip-count', '1');
		await expect(editor).not.toHaveAttribute('data-edit-block-reason', 'importing');
		const downloading = page.waitForEvent('download'); await chooseExportProjectFileAction(page, editor);
		const files = unzipSync(await downloadBytes(await downloading));
		const project = parseScapeProjectDocument(strFromU8(files['project.json']), { currentProjectSchemaFamily: 'soundscaper' });
		expect(project.sources).toHaveLength(1);
		expect(project.sources[0].provenance.contributions[0].metadata.raw.TXXX[key]).toBe('Reviewed credit');
		expect(project.featureRequirements.requirements.some(row => row.featureId === 'org.soundscaper.capability.literal-json-keys')).toBe(key === '$soundscaperOpaqueBinary');
	}
});
