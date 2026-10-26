/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseFileAction, disableNativeSavePicker, waitForProjectActivation } from './audio-editor-test-helpers.js';
import { exportSamples } from './helpers/round2-audio-export.js';

for (const gain of [8, 10 ** (36 / 20), 4]) test(`legacy AUP gain ${gain} exports its authored level`, async ({ page }) => {
	test.setTimeout(90_000);
	const frames = 4800, bytes = new Uint8Array(24 + frames * 4), view = new DataView(bytes.buffer);
	for (const [index, value] of [0x2e736e64, 24, frames * 4, 6, 48_000, 1].entries()) view.setUint32(index * 4, value);
	for (let frame = 0; frame < frames; frame++) view.setFloat32(24 + frame * 4, .002);
	const xml = `<project rate="48000"><wavetrack name="Voice" channel="2" rate="48000" gain="${gain}"><waveclip name="Voice" offset="0">`
		+ `<sequence numsamples="${frames}"><waveblock start="0"><simpleblockfile filename="e0000.au" len="${frames}"/></waveblock></sequence>`
		+ '</waveclip></wavetrack></project>';
	await disableNativeSavePicker(page); const editor = await bootEditor(page, '/embed/en/', { defaultWorkspace: true });
	const choosing = page.waitForEvent('filechooser'); await chooseFileAction(page, editor, 'Import');
	await (await choosing).setFiles([
		{ name: 'Fader gain.aup', mimeType: 'text/xml', buffer: Buffer.from(xml) },
		{ name: 'e0000.au', mimeType: 'audio/basic', buffer: Buffer.from(bytes) },
	]);
	await expect(editor.locator('[data-status]')).toContainText('Imported the legacy AUP tracks, clips, and labels.', { timeout: 30_000 });
	await expect(editor).toHaveAttribute('data-clip-count', '1'); await waitForProjectActivation(editor);
	const projectId = await editor.getAttribute('data-project-id');
	const rendered = await exportSamples(page, editor);
	expect(rendered).toHaveLength(4800);
	expect(rendered[1000]).toBeCloseTo(.002 * gain / Math.SQRT2, 5);
	await page.reload(); await expect(editor).toHaveAttribute('data-project-id', projectId); await waitForProjectActivation(editor);
	const reopened = await exportSamples(page, editor);
	expect(reopened).toHaveLength(rendered.length); expect(reopened[1000]).toBeCloseTo(rendered[1000], 6);
});
