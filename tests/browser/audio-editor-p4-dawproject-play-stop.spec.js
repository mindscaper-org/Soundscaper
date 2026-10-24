/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { strFromU8, unzipSync } from 'fflate';
import { bootEditor, chooseFileAction, chooseExportProjectFileAction, disableNativeSavePicker, downloadBytes, waitForProjectActivation } from './audio-editor-test-helpers.js';
import { writeDawprojectArchive } from '../../src/common/editor/dawproject-archive.ts';
import { parseScapeProjectDocument } from '../../src/common/editor/scape-project-document.ts';
import { encodeWav } from '../../src/common/editor/wav.js';
import { exportSamples } from './helpers/round2-audio-export.js';

for (const stopped of [true, false]) test(`DAWproject File Open delivers ${stopped ? 'only the authored playStop span' : 'ordinary unstopped content'}`, async ({ page }) => {
	test.setTimeout(90_000);
	const samples = Float32Array.from({ length: 192_000 }, (_, frame) => frame < 48_000 ? .25 : -.5);
	const audio = new Blob([encodeWav([samples], { sampleRate: 48_000, float: true })]);
	const archive = await writeDawprojectArchive({ metadataXml: '<MetaData><Title>Content stop</Title></MetaData>',
		projectXml: `<Project version="1.0"><Application name="Soundscaper regression" version="1"/><Transport><Tempo unit="bpm" value="120"/></Transport><Structure><Track id="voice" name="Voice" contentType="audio"><Channel role="regular"/></Track></Structure>
		<Arrangement><Lanes timeUnit="seconds"><Lanes track="voice"><Clips><Clip time="0" duration="2" ${stopped ? 'playStop="1"' : ''} contentTimeUnit="seconds" name="Take">
		<Audio channels="1" sampleRate="48000" duration="4"><File path="audio/voice.wav"/></Audio></Clip></Clips></Lanes></Lanes></Arrangement></Project>`,
		files: [{ path: 'audio/voice.wav', blob: audio }] });
	await disableNativeSavePicker(page); const editor = await bootEditor(page, '/embed/en/', { defaultWorkspace: true });
	const choosing = page.waitForEvent('filechooser'); await chooseFileAction(page, editor, 'Open');
	await (await choosing).setFiles({ name: 'Content stop.dawproject', mimeType: 'application/zip', buffer: Buffer.from(await archive.arrayBuffer()) });
	await expect(editor.locator('[data-status]')).toContainText('DAWproject imported.', { timeout: 30_000 });
	await waitForProjectActivation(editor); await expect(editor).toHaveAttribute('data-clip-count', '1');
	await chooseFileAction(page, editor, 'Delivery Report');
	const report = page.getByRole('dialog', { name: 'Delivery Report', exact: true });
	await expect(report).not.toContainText('Clip looping is not imported');
	await page.keyboard.press('Escape'); await expect(report).toBeHidden();
	const delivered = await exportSamples(page, editor);
	expect(delivered).toHaveLength(96_000);
	const maximumError = (values, expected) => values.reduce((maximum, value, index) => Math.max(maximum, Math.abs(value - expected(index))), 0);
	// The ordinary 24-bit export applies fresh dither on each delivery.
	const quantizationBound = 4 / 2 ** 23;
	expect(maximumError(delivered.slice(1, 48_000), () => .25 * Math.SQRT1_2)).toBeLessThan(quantizationBound);
	expect(maximumError(delivered.slice(48_000), () => stopped ? 0 : -.5 * Math.SQRT1_2)).toBeLessThan(quantizationBound);
	const saving = page.waitForEvent('download'); await chooseExportProjectFileAction(page, editor);
	const download = await saving; let saved;
	try { saved = await downloadBytes(download); } finally { await download.delete(); }
	const project = parseScapeProjectDocument(strFromU8(unzipSync(saved)['project.json']), { currentProjectSchemaFamily: 'soundscaper' });
	expect(project.clips[0].durationFrames).toBe(96_000); expect(project.clips[0].sourceDurationFrames).toBe(96_000);
	expect(project.sources[0].frameCount).toBe(192_000);
	const reopening = page.waitForEvent('filechooser'); await chooseFileAction(page, editor, 'Open');
	await (await reopening).setFiles({ name: 'Saved content stop.sscape', mimeType: 'application/zip', buffer: Buffer.from(saved) });
	const collision = page.getByRole('dialog', { name: 'Project already exists', exact: true });
	await collision.getByRole('button', { name: 'Open as copy', exact: true }).click();
	await expect(editor).not.toHaveAttribute('data-project-id', project.id); await waitForProjectActivation(editor);
	const reopened = await exportSamples(page, editor);
	expect(reopened).toHaveLength(delivered.length);
	expect(maximumError(reopened, index => delivered[index])).toBeLessThan(quantizationBound);
});
