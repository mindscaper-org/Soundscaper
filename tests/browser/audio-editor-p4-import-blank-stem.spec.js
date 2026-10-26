/* SPDX-License-Identifier: AGPL-3.0-only */
import { strFromU8, unzipSync } from 'fflate';
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseFileAction, chooseExportProjectFileAction, disableNativeSavePicker, downloadBytes, waitForEditor, waitForProjectActivation } from './audio-editor-test-helpers.js';
import { exportSamples } from './helpers/round2-audio-export.js';
import { encodeWav } from '../../src/common/editor/wav.js';
import { parseScapeProjectDocument } from '../../src/common/editor/scape-project-document.ts';

for (const name of ['   .wav', ' Voice .wav']) test(`File Import accepts healthy PCM named ${JSON.stringify(name)} through native Save and reload`, async ({ page }) => {
	test.setTimeout(90_000);
	await disableNativeSavePicker(page); let editor = await bootEditor(page, '/embed/en/', { defaultWorkspace: true });
	const choosing = page.waitForEvent('filechooser'); await chooseFileAction(page, editor, 'Import');
	await (await choosing).setFiles({ name, mimeType: 'audio/wav', buffer: Buffer.from(encodeWav([new Float32Array(4800).fill(.25), new Float32Array(4800).fill(-.125)], { sampleRate: 48_000, float: true })) });
	await expect(editor).toHaveAttribute('data-clip-count', '1', { timeout: 30_000 });
	await waitForProjectActivation(editor);
	for (const reload of [false, true]) {
		if (reload) { await page.reload(); editor = await waitForEditor(page); await waitForProjectActivation(editor); }
		const pcm = await exportSamples(page, editor); expect(pcm).toHaveLength(4800); expect(pcm[2000]).toBeCloseTo(.25, 5);
		const downloading = page.waitForEvent('download'); await chooseExportProjectFileAction(page, editor);
		const download = await downloading; let bytes; try { bytes = await downloadBytes(download); } finally { await download.delete(); }
		const files = unzipSync(bytes); const project = parseScapeProjectDocument(strFromU8(files['project.json']), { currentProjectSchemaFamily: 'soundscaper' });
		expect(project.sources).toHaveLength(1); expect(project.clips).toHaveLength(1);
		expect(project.sources[0].name).toBe(name); expect(project.sources[0].provenance.contributions[0].origin.originalFileName).toBe(name);
		const track = project.tracks.find(track => track.type === 'audio' && track.clipIds.includes(project.clips[0].id));
		expect(track.name.trim()).not.toBe(''); expect(project.clips[0].title).toBe(track.name);
		if (name === ' Voice .wav') expect(track.name).toBe(' Voice ');
	}
});
