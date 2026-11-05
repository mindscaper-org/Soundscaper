/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './helpers/browser-coverage-fixture.js';
import { readParametricEqSpectrum } from './helpers/parametric-eq-spectrum-probe.ts';

// This control qualifies a test probe against native Canvas rasterization.
test.use({ browserCoverage: false });

test('Parametric EQ raster probe retains the tip of a narrow translucent peak', async ({ page }) => {
	await page.setContent('<canvas width="880" height="308"></canvas>');
	const canvas = page.locator('canvas');
	await canvas.evaluate((element: HTMLCanvasElement) => {
		const context = element.getContext('2d');
		if (!context) throw new Error('The control requires a 2D canvas.');
		context.fillStyle = 'rgba(82, 155, 255, 0.18)';
		context.beginPath();
		context.moveTo(0, element.height);
		context.lineTo(198, element.height);
		context.lineTo(200, 40);
		context.lineTo(202, element.height);
		context.lineTo(element.width, element.height);
		context.closePath();
		context.fill();
	});
	const { plot } = await canvas.evaluate(readParametricEqSpectrum);
	expect(plot.width).toBe(880);
	expect(plot.height).toBe(308);
	expect(plot.top).toBeGreaterThanOrEqual(39 / 308);
	expect(plot.top).toBeLessThan(.2);
	expect(Math.abs(plot.peakX - 200)).toBeLessThanOrEqual(1);
});
