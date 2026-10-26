/* SPDX-License-Identifier: AGPL-3.0-only */

import { createWavFixture, expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, closeClipProperties, disableNativeSavePicker, importFiles, openClipProperties, openSourceMonitor } from './audio-editor-test-helpers.js';
import { exportSamples } from './helpers/round2-audio-export.js';

for (const reversed of [false, true]) test(`Source Editor extends hidden media on its raw clock (reversed ${String(reversed)})`, async ({ page }) => {
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [createWavFixture({ name: 'source-clock.wav', duration: 2, frequency: 500, channelCount: 1 })]);
	const clip = editor.locator('[data-clip-id]').first();
	const properties = await openClipProperties(page, editor, clip, { additional: false });
	const speed = properties.getByRole('textbox', { name: 'Speed', exact: true });
	await speed.fill('200'); await speed.press('Enter'); await expect(speed).toHaveValue('200');
	if (reversed) await properties.getByRole('switch', { name: 'Reverse', exact: true }).click();
	await closeClipProperties(properties);
	const source = await openSourceMonitor(page, editor, clip);
	const end = source.getByRole('button', { name: 'Trim source end', exact: true });
	for (let step = 0; step < 10; step++) await end.press('Shift+ArrowLeft');
	const wave = source.locator('.audio-editor-source-wave-area');
	const box = await wave.boundingBox(), handle = await end.boundingBox();
	expect(box).toBeTruthy(); expect(handle).toBeTruthy();
	// Active output is0.5s; the unused second source second occupies another1s.
	// Display1s therefore names raw source1.5s, not the active output's2x clock.
	await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
	await page.mouse.down(); await page.mouse.move(box.x + box.width * 2 / 3, handle.y + handle.height / 2, { steps: 5 }); await page.mouse.up();
	await closeClipProperties(source);
	const samples = await exportSamples(page, editor);
	expect(Math.abs(samples.length - 36_000)).toBeLessThan(200);
	expect(Math.max(...samples.slice(1000, 2000).map(Math.abs))).toBeGreaterThan(.1);
	await editor.getByRole('button', { name: 'Undo', exact: true }).click();
	expect(await exportSamples(page, editor)).toHaveLength(24_000);
	await editor.getByRole('button', { name: 'Redo', exact: true }).click();
	expect(await exportSamples(page, editor)).toHaveLength(samples.length);
});
