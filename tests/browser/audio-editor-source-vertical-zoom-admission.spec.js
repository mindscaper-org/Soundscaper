/* SPDX-License-Identifier: AGPL-3.0-only */
import { createWavFixture, expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, clipByName, importFiles, openSourceMonitor } from './audio-editor-test-helpers.js';

for (const mode of ['Waveform', 'Multi-view']) test(`Source ${mode} keeps working amplitude zoom controls`, async ({ page }) => {
	const { vertical, canvas, choose } = await sourceView(page, mode);
	const amplitude = vertical.locator('.vertical-ruler').nth(mode === 'Multi-view' ? 1 : 0);
	const height = async () => (await amplitude.boundingBox()).height;
	const originalHeight = await height(), originalPaint = await paintHash(canvas);
	await choose('Zoom in');
	await expect.poll(height).toBeGreaterThan(originalHeight);
	await expect.poll(() => paintHash(canvas)).not.toBe(originalPaint);
	const zoomedHeight = await height(), zoomedPaint = await paintHash(canvas);
	await choose('Zoom out');
	await expect.poll(height).toBeLessThan(zoomedHeight);
	await expect.poll(() => paintHash(canvas)).not.toBe(zoomedPaint);
});

test('Source pure Spectrogram does not offer amplitude-only zoom actions', async ({ page }) => {
	const { vertical, canvas, open } = await sourceView(page, 'Spectrogram');
	await expect.poll(() => canvas.evaluate(element => {
		const pixels = element.getContext('2d').getImageData(0, 0, element.width, element.height).data;
		let coloured = 0;
		for (let index = 0; index < pixels.length; index += 4) {
			if (Math.max(pixels[index], pixels[index + 1], pixels[index + 2]) - Math.min(pixels[index], pixels[index + 1], pixels[index + 2]) > 40) coloured++;
		}
		return coloured;
	})).toBeGreaterThan(100);
	await expect(vertical.locator('.vertical-ruler__label').first()).toHaveText('24k');
	await expect(vertical.locator('.vertical-ruler__label').last()).toHaveText('0');
	await open();
	for (const label of ['Zoom in', 'Zoom out']) {
		await expect(page.getByRole('menuitem', { name: label, exact: true })).toHaveAttribute('aria-disabled', 'true');
	}
});

async function sourceView(page, mode) {
	const editor = await bootEditor(page, '/embed/en/', { showProjectBin: false });
	const file = createWavFixture({ name: 'Source zoom.wav', sampleRate: 48000, frequency: 3000, duration: 1, channelCount: 1 });
	await importFiles(editor, [file]);
	const panel = await openSourceMonitor(page, editor, clipByName(editor, file.name));
	const vertical = panel.getByRole('region', { name: 'Source vertical ruler', exact: true });
	const canvas = panel.locator('[data-source-active="true"] canvas').first();
	await expect(canvas).toHaveAttribute('width', /[1-9]\d*/u);
	const open = () => vertical.click({ button: 'right', position: { x: 12, y: 4 } });
	const choose = async label => {
		await open();
		await page.getByRole('menuitem', { name: label, exact: true }).click();
	};
	if (mode !== 'Waveform') {
		await choose(mode);
		await expect(canvas).toHaveAttribute('data-spectrogram-renderer', /./u);
	}
	return { vertical, canvas, choose, open };
}

async function paintHash(canvas) {
	return canvas.evaluate(element => {
		const value = element.toDataURL();
		let hash = 2166136261;
		for (let index = 0; index < value.length; index++) hash = Math.imul(hash ^ value.charCodeAt(index), 16777619);
		return hash >>> 0;
	});
}
