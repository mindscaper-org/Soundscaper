/* SPDX-License-Identifier: AGPL-3.0-only */

import { EDITOR_ENGLISH_COPY } from '../../src/common/i18n/editor-copy-inventory.ts';
import { createWavFixture, expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseNestedCommandAction, importFiles } from './audio-editor-test-helpers.js';
import { hasWebGl2Capability } from './helpers/webgl2-capability.js';

test('menu-authored translucent spectrum retains the Canvas single-path alpha at its vertices', async ({ page }) => {
	await page.addInitScript(() => {
		globalThis.__spectrumPolyline = [];
		const put = CanvasRenderingContext2D.prototype.putImageData;
		CanvasRenderingContext2D.prototype.putImageData = function (...args) {
			const result = Reflect.apply(put, this, args), image = args[0];
			if (image.width !== 1280 || image.height !== 720) return result;
			const sample = x => Array.from(image.data.subarray(((image.height - 1) * image.width + x) * 4,
				((image.height - 1) * image.width + x) * 4 + 4));
			globalThis.__spectrumPolyline.push([sample(640), sample(1279)]);
			return result;
		};
	});
	const editor = await bootEditor(page, '/framescaper/embed/en/');
	test.skip(!await page.evaluate(hasWebGl2Capability), 'Spectrum pixel parity requires the maintained exact WebGL2 preview.');
	await importFiles(editor, [createWavFixture({ name: 'Quiet.wav', frequency: 440, duration: 1, channelCount: 1, channelAmplitudes: [0] })]);
	await chooseNestedCommandAction(page, editor, 'Generate', ['Video Generators', EDITOR_ENGLISH_COPY['ui.framescaperMenus.addSoundVisualizer']]);
	await editor.getByRole('group', { name: 'Video clip: Sound Visualizer', exact: true }).press('Enter');
	await chooseNestedCommandAction(page, editor, 'Effect', ['Video Finishing', EDITOR_ENGLISH_COPY['ui.framescaperMenus.videoVisualInspector']]);
	const dialog = page.getByRole('dialog', { name: 'Selected Visual Inspector', exact: true });
	await dialog.getByRole('combobox', { name: 'Visualization', exact: true }).selectOption('spectrum');
	await dialog.getByRole('textbox', { name: 'Foreground RGBA color', exact: true }).fill('#ffffff80');
	await dialog.getByRole('textbox', { name: 'Background RGBA color', exact: true }).fill('#00000000');
	await dialog.getByRole('button', { name: 'Apply', exact: true }).click();
	await expect(dialog.getByRole('status').last()).toHaveText('Selected visual updated.');
	const oracle = await page.evaluate(() => {
		const canvas = document.createElement('canvas'); canvas.width = 1280; canvas.height = 720;
		const context = canvas.getContext('2d'); context.strokeStyle = 'rgba(255,255,255,0.5019607843137255)';
		context.lineWidth = 1; context.beginPath(); context.moveTo(0, 719.5); context.lineTo(1280, 719.5); context.stroke();
		return Array.from(context.getImageData(640, 719, 1, 1).data);
	});
	expect(oracle).toEqual([255, 255, 255, 128]);
	// The exact programme composites the Canvas coverage over black in its
	// linear working space and encodes the standard Rec.709 output transfer.
	const encoded = Math.round(255 * (1.099 * (oracle[3] / 255) ** .45 - .099));
	await expect.poll(() => page.evaluate(() => globalThis.__spectrumPolyline.at(-1)))
		.toEqual([[encoded, encoded, encoded, 255], [encoded, encoded, encoded, 255]]);
});
