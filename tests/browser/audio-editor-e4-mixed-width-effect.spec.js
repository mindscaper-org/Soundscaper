/* SPDX-License-Identifier: AGPL-3.0-only */
import { createWavFixture, expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, clipByName, collectClientErrors, commitInput, disableNativeSavePicker, importFiles, openSelectionEffectDialog } from './audio-editor-test-helpers.js';
import { exportSamples } from './helpers/round2-audio-export.js';

test('a selected mono effect keeps listening gain after another stereo clip ends', async ({ page }) => {
	const clientErrors = collectClientErrors(page); await disableNativeSavePicker(page); const editor = await bootEditor(page, '/embed/en/');
	const wide = createWavFixture({ name: 'Wide.wav', duration: .25, channelCount: 2, channelAmplitudes: [0, 0] });
	const mono = createWavFixture({ name: 'Mono.wav', duration: 1, channelCount: 1, channelAmplitudes: [.25], frequency: 440 });
	await importFiles(editor, [wide, mono]); const clip = clipByName(editor, mono.name);
	await clip.locator('.clip-header').click({ button: 'right' });
	const move = page.locator('.audio-editor-clip-context-menu').getByRole('menuitem', { name: /^Move to track \(preserve time\)/u });
	await move.hover(); await move.getByRole('menuitem', { name: /Wide/u }).click();
	const before = await exportSamples(page, editor);
	await clip.locator('.clip-header').click(); const dialog = await openSelectionEffectDialog(page, editor);
	await commitInput(dialog.locator('[data-effect-param="volumeDb"] input'), '-6');
	await dialog.getByRole('button', { name: 'Apply to selection', exact: true }).click(); await expect(dialog).toBeHidden({ timeout: 20_000 });
	const after = await exportSamples(page, editor); expect(after).toHaveLength(before.length);
	const gain = 10 ** (-6 / 20);
	const errors = [4800, 24000].map(start => Math.max(...after.slice(start, start + 4800).map((sample, offset) => Math.abs(sample - before[start + offset] * gain))));
	for (const error of errors) expect(error).toBeLessThan(.0001);
	await editor.getByRole('button', { name: 'Undo', exact: true }).click();
	const undone = await exportSamples(page, editor);
	expect(Math.max(...undone.map((sample, index) => Math.abs(sample - before[index])))).toBeLessThan(.0001);
	await editor.getByRole('button', { name: 'Redo', exact: true }).click();
	const redone = await exportSamples(page, editor);
	expect(Math.max(...redone.map((sample, index) => Math.abs(sample - after[index])))).toBeLessThan(.0001);
	expect(clientErrors).toEqual([]);
});
