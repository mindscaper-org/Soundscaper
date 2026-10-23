/* SPDX-License-Identifier: AGPL-3.0-only */
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseNestedCommandAction, disableNativeSavePicker, openSourceMonitor, waitForProjectActivation } from './audio-editor-test-helpers.js';
import { encodeWav } from '../../src/common/editor/wav.js';
import { exportSamples } from './helpers/round2-audio-export.js';

for (const amplitude of [1e-40, .125]) test(`Normalize restores a finite float recording at amplitude ${amplitude}`, async ({ page }) => {
	const samples = Float32Array.from({ length: 48_000 }, (_, frame) => amplitude * Math.sin(2 * Math.PI * 500 * frame / 48_000));
	const file = { name: 'Quiet float.wav', mimeType: 'audio/wav', buffer: Buffer.from(encodeWav([samples], { sampleRate: 48_000, float: true })) };
	await disableNativeSavePicker(page); const editor = await bootEditor(page, '/embed/en/');
	await editor.locator('[data-aup4-input]').setInputFiles(file);
	await expect(editor.locator('[data-clip-id]')).toHaveCount(1); await waitForProjectActivation(editor);
	const panel = await openSourceMonitor(page, editor, editor.locator('[data-clip-id]'));
	await panel.getByRole('region', { name: 'Source waveform', exact: true }).press('Control+a');
	await expect(panel.locator('.audio-editor-source-selection')).toHaveCount(1);
	await chooseNestedCommandAction(page, editor, 'Effect', ['Volume and compression', 'Normalize']);
	const dialog = page.getByRole('dialog', { name: 'Apply effect', exact: true });
	await dialog.getByRole('button', { name: 'Apply to selection', exact: true }).click();
	await expect(dialog).toBeHidden({ timeout: 20_000 });
	const output = await exportSamples(page, editor);
	expect(output).toHaveLength(48_000); expect(output.every(Number.isFinite)).toBe(true);
	const peak = Math.max(...output.map(Math.abs)); expect(peak).toBeGreaterThan(.5); expect(peak).toBeLessThan(.7);
});
