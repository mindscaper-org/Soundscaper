/* SPDX-License-Identifier: AGPL-3.0-only */
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, collectClientErrors, commitInput, disableNativeSavePicker, importFiles, openSelectionEffectDialog } from './audio-editor-test-helpers.js';
import { encodeWav } from '../../src/common/editor/wav.js';
import { exportSamples } from './helpers/round2-audio-export.js';

test('applying a selection effect to a loop preserves its rendered pitch and repetitions', async ({ page }) => {
	const errors = collectClientErrors(page); await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/embed/en/');
	const samples = Float32Array.from({ length: 24_000 }, (_, frame) => .25 * Math.sin(2 * Math.PI * 440 * frame / 48_000));
	await importFiles(editor, [{ name: 'Loop.wav', mimeType: 'audio/wav', buffer: Buffer.from(encodeWav([samples], { sampleRate: 48_000, float: true })) }]);
	const clip = editor.locator('[data-clip-id]'); await clip.locator('.clip-header').click();
	const loop = clip.getByRole('slider', { name: 'Looped clip length', exact: true });
	await loop.press('ArrowRight'); await expect(loop).toHaveAttribute('aria-valuenow', '1');
	const before = await exportSamples(page, editor); expect(before).toHaveLength(48_000);
	await clip.locator('.clip-header').click();
	const dialog = await openSelectionEffectDialog(page, editor);
	await commitInput(dialog.locator('[data-effect-param="volumeDb"] input'), '-6');
	await dialog.getByRole('button', { name: 'Apply to selection', exact: true }).click();
	await expect(dialog).toBeHidden({ timeout: 20_000 });
	const after = await exportSamples(page, editor); expect(after).toHaveLength(before.length);
	const gain = 10 ** (-6 / 20);
	const error = Math.max(...after.slice(1000, 47000).map((sample, index) => Math.abs(sample - before[index + 1000] * gain)));
	expect(error).toBeLessThan(.0001);
	await editor.getByRole('button', { name: 'Undo', exact: true }).click();
	await expect(clip.locator('[data-loop-boundary-frame]')).toHaveCount(1);
	await editor.getByRole('button', { name: 'Redo', exact: true }).click();
	await expect(clip.locator('[data-loop-boundary-frame]')).toHaveCount(0);
	expect(errors).toEqual([]);
});
