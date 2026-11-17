/* SPDX-License-Identifier: AGPL-3.0-only */
import { strFromU8, unzipSync } from 'fflate';
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseExportProjectFileAction, disableNativeSavePicker, downloadBytes, importFiles, waitForProjectActivation } from './audio-editor-test-helpers.js';
import { exportSamples } from './helpers/round2-audio-export.js';
import { parseScapeProjectDocument } from '../../src/common/editor/scape-project-document.ts';
import { omfCompositionClockBytes } from '../helpers/omf-composition-clock-fixture.ts';

test('OMF File Import retains a 48k composition containing 44.1k native audio', async ({ page }) => {
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/embed/en/', { showProjectBin: false });
	await importFiles(editor, [{ name: 'Native clocks.omf', mimeType: 'application/octet-stream', buffer: Buffer.from(omfCompositionClockBytes(48000, 44100)) }]);
	await expect(editor).toHaveAttribute('data-clip-count', '1');
	await expect(editor).not.toHaveAttribute('data-edit-block-reason', 'importing');
	await waitForProjectActivation(editor);
	const downloading = page.waitForEvent('download');
	await chooseExportProjectFileAction(page, editor);
	const download = await downloading;
	let bytes;
	try { bytes = await downloadBytes(download); } finally { await download.delete(); }
	const entries = unzipSync(bytes);
	const project = parseScapeProjectDocument(strFromU8(entries['project.json']), { currentProjectSchemaFamily: 'soundscaper' });
	expect(project.sampleRate).toBe(48000);
	expect(project.sources[0].sampleRate).toBe(44100);
	expect(project.clips[0].timelineStartFrame).toBe(1);
	expect(project.clips[0].durationFrames).toBe(4800);
	const pcm = await exportSamples(page, editor, { sampleRate: 48000, includeTail: false });
	expect(pcm[2400]).toBeCloseTo(.25 / Math.sqrt(2), 4);
});
