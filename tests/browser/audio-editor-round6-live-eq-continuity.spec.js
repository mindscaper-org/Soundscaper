/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { addRackEffect, bootEditor, waitForProjectActivation, openEffectsForTrack } from './audio-editor-test-helpers.js';
import { liveEffectToneProject } from './fixtures/live-effect-tone-project.ts';
import { installLiveOutputObserver, waitForLiveOutputObserver } from './helpers/live-output-observer.js';

// Permit the test-only blob worklet without changing the shipped script policy.
test.use({ browserCoverage: false, bypassCSP: true });

test('a live Graphic EQ band edit preserves the already audible recording at unchanged filter geometry', async ({ page }) => {
	await installLiveOutputObserver(page, '__round6EqOutput');
	const editor = await bootEditor(page, '/embed/en/');
	const { projectId, file } = await liveEffectToneProject();
	await editor.locator('[data-aup4-input]').setInputFiles(file);
	await expect(editor).toHaveAttribute('data-project-id', projectId);
	await waitForProjectActivation(editor);
	const panel = await openEffectsForTrack(editor, 0);
	await addRackEffect(page, panel, 'track', 'Graphic EQ');
	const dialog = page.getByRole('dialog', { name: 'Graphic EQ', exact: true });
	const band = dialog.getByRole('slider', { name: '1000 Hz', exact: true });
	await band.focus();
	await waitForLiveOutputObserver(page);
	await editor.getByRole('button', { name: 'Play', exact: true }).click();
	await expect.poll(() => page.evaluate(() => window.__round6EqOutput.some(sample => sample.rms > .2))).toBe(true);
	const healthyAt = await page.evaluate(() => window.__round6EqOutput.at(-1).time);
	await expect.poll(() => page.evaluate(time => window.__round6EqOutput.at(-1).time - time, healthyAt)).toBeGreaterThan(.3);
	const healthy = await page.evaluate(time => window.__round6EqOutput.filter(sample => sample.time > time), healthyAt);
	expect(Math.min(...healthy.map(sample => sample.rms))).toBeGreaterThan(.2);
	const changedAt = await page.evaluate(() => window.__round6EqOutput.at(-1).time);
	await band.focus();
	await band.press('ArrowUp');
	await expect(band).toHaveAttribute('aria-valuenow', '1');
	await expect.poll(() => page.evaluate(time => window.__round6EqOutput.at(-1).time - time, changedAt)).toBeGreaterThan(.4);
	const changed = await page.evaluate(time => window.__round6EqOutput.filter(sample => sample.time > time), changedAt);
	console.log('ordinary live Graphic EQ edit native output', {
		beforeMinimumRms: Math.min(...healthy.map(sample => sample.rms)),
		afterMinimumRms: Math.min(...changed.map(sample => sample.rms)),
		lostFrames: changed.filter(sample => sample.rms < .01).length * 256,
	});
	expect(Math.min(...changed.map(sample => sample.rms))).toBeGreaterThan(.2);
	await editor.getByRole('button', { name: 'Stop', exact: true }).click();
});
