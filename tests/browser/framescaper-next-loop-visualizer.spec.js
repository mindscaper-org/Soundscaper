/* SPDX-License-Identifier: AGPL-3.0-only */

import { hasWebGl2Capability } from './helpers/webgl2-capability.js';
import { expect, test, createWavFixture } from './audio-editor-test-fixtures.js';
import { bootEditor, collectClientErrors, importFiles, clipByName, chooseNestedCommandAction, closeDialog } from './audio-editor-test-helpers.js';
import { seekFramescaperTimecode } from './helpers/framescaper-standard-timecode.js';
import { EDITOR_ENGLISH_COPY } from '../../src/common/i18n/editor-copy-inventory.ts';

test('Sound Visualizer repeats the authored PCM instead of stretching it', async ({ page }) => {
	test.setTimeout(60_000);
	await page.addInitScript(() => {
		globalThis.__loopVisual = [];
		const put = CanvasRenderingContext2D.prototype.putImageData;
		CanvasRenderingContext2D.prototype.putImageData = function (...args) {
			const result = Reflect.apply(put, this, args), frame = args[0];
			if (frame.width < 320 || frame.height < 180) return result;
			let sum = 0, count = 0;
			for (let y = 0; y < frame.height; y++) for (let x = 0; x < frame.width; x++) {
				const offset = (y * frame.width + x) * 4;
				if (frame.data[offset] === 255 && frame.data[offset + 1] === 0
					&& frame.data[offset + 2] === 0 && frame.data[offset + 3] === 255) { sum += y; count++; }
			}
			if (count) {
				globalThis.__loopVisual.push({ sample: document.querySelector('[data-video-preview]')?.getAttribute('data-video-preview-evaluated-timeline-sample'), row: sum / count / frame.height });
				if (globalThis.__loopVisual.length > 32) globalThis.__loopVisual.shift();
			}
			return result;
		};
	});
	const file = createWavFixture({ name: 'Loop levels.wav', frequency: 440, duration: 1, channelCount: 1 });
	for (let frame = 0; frame < 48_000; frame++) file.buffer.writeInt16LE(Math.round((frame < 24_000 ? 0.25 : 0.75) * 32767), 44 + frame * 2);
	const errors = collectClientErrors(page);
	const editor = await bootEditor(page, '/framescaper/embed/en/');
	const exactPreviewAvailable = await page.evaluate(hasWebGl2Capability);
	await importFiles(editor, [file]);
	const clip = clipByName(editor, file.name); await clip.locator('.clip-header').click();
	const loop = clip.getByRole('slider', { name: 'Looped clip length', exact: true });
	await loop.press('ArrowRight'); await expect(loop).toHaveAttribute('aria-valuenow', '2');
	await chooseNestedCommandAction(page, editor, 'Generate', ['Video Generators', EDITOR_ENGLISH_COPY['ui.framescaperMenus.addSoundVisualizer']]);
	await editor.getByRole('group', { name: 'Video clip: Sound Visualizer', exact: true }).press('Enter');
	await chooseNestedCommandAction(page, editor, 'Effect', ['Video Finishing', EDITOR_ENGLISH_COPY['ui.framescaperMenus.videoVisualInspector']]);
	const dialog = page.getByRole('dialog', { name: 'Selected Visual Inspector', exact: true });
	await dialog.getByRole('spinbutton', { name: 'View window (seconds)', exact: true }).fill('0.01');
	await dialog.getByRole('textbox', { name: 'Foreground RGBA color', exact: true }).fill('#ff0000ff');
	await dialog.getByRole('button', { name: 'Apply', exact: true }).click();
	await expect(dialog.getByRole('status')).toHaveText('Selected visual updated.'); await closeDialog(dialog);
	await page.evaluate(() => { globalThis.__loopVisual = []; });
	await seekFramescaperTimecode(page, editor, '00:00:01:06');
	const preview = editor.locator('[data-video-preview]');
	if (!exactPreviewAvailable) {
		await expect(preview).toHaveAttribute('data-video-preview-renderer', 'fallback');
		await expect(preview).toHaveAttribute('data-video-preview-visual-pending', 'false');
		await expect(preview).toHaveAttribute('data-video-preview-visual-error', '');
		expect(errors).toEqual([]);
		return;
	}
	await expect(editor.locator('[data-video-preview]')).toHaveAttribute('data-video-preview-evaluated-timeline-sample', '57600');
	// Canvas paint precedes the DOM timestamp in WebKit; inspect the latest new paint after the completed seek.
	// At 1.2s the repeated first half is +0.25, so its waveform occupies y=(1-.25)/2.
	await expect.poll(() => page.evaluate(() => globalThis.__loopVisual.at(-1)?.row)).toBeCloseTo(0.375, 2);
	expect(errors).toEqual([]);
});
