/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseFileAction, chooseNestedCommandAction, disableNativeSavePicker, waitForProjectActivation } from './audio-editor-test-helpers.js';
import { exportSamples } from './helpers/round2-audio-export.js';

for (const offset of [-.1, 0, -.3]) test(`legacy AUP at ${offset}s exports only the original visible programme`, async ({ page }) => {
	test.setTimeout(90_000);
	const frames = 9600, bytes = new Uint8Array(24 + frames * 4), view = new DataView(bytes.buffer);
	for (const [index, value] of [0x2e736e64, 24, frames * 4, 6, 48_000, 1].entries()) view.setUint32(index * 4, value);
	for (let frame = 0; frame < frames; frame++) view.setFloat32(24 + frame * 4, frame < frames / 2 ? .25 : -.125);
	const xml = `<project rate="48000"><wavetrack name="Voice" channel="2" rate="48000"><waveclip name="Voice" offset="${offset}">`
		+ `<sequence numsamples="${frames}"><waveblock start="0"><simpleblockfile filename="e0000.au" len="${frames}"/></waveblock></sequence>`
		+ '</waveclip></wavetrack></project>';
	await disableNativeSavePicker(page); const editor = await bootEditor(page, '/embed/en/', { defaultWorkspace: true });
	const choosing = page.waitForEvent('filechooser'); await chooseFileAction(page, editor, 'Import');
	await (await choosing).setFiles([
		{ name: 'Before zero.aup', mimeType: 'text/xml', buffer: Buffer.from(xml) },
		{ name: 'e0000.au', mimeType: 'audio/basic', buffer: Buffer.from(bytes) },
	]);
	await expect(editor.locator('[data-status]')).toContainText('Imported the legacy AUP tracks, clips, and labels.', { timeout: 30_000 });
	await expect(editor).toHaveAttribute('data-clip-count', offset === -.3 ? '0' : '1'); await waitForProjectActivation(editor);
	if (offset === -.3) {
		await chooseNestedCommandAction(page, editor, 'Window', ['Project bin']);
		const card = editor.locator('[data-project-bin-item]'); await expect(card).toHaveCount(1);
		await card.getByRole('button', { name: 'Add to timeline: Voice', exact: true }).click();
		await expect(editor).toHaveAttribute('data-clip-count', '1');
	}
	const projectId = await editor.getAttribute('data-project-id');
	const rendered = await exportSamples(page, editor);
	expect(rendered).toHaveLength(offset === -.1 ? 4800 : 9600);
	expect(rendered[1000]).toBeCloseTo((offset === -.1 ? -.125 : .25) / Math.SQRT2, 5);
	if (offset < 0) await expect(editor.locator('[data-status]')).not.toHaveAttribute('data-state', 'error');
	await page.reload(); await expect(editor).toHaveAttribute('data-project-id', projectId); await waitForProjectActivation(editor);
	const reopened = await exportSamples(page, editor);
	expect(reopened).toHaveLength(rendered.length); expect(reopened[1000]).toBeCloseTo(rendered[1000], 6);
});
