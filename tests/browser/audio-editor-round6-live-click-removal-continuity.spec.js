/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { addRackEffect, bootEditor, commitInput, waitForProjectActivation, openEffectsForTrack } from './audio-editor-test-helpers.js';
import { liveEffectToneProject } from './fixtures/live-effect-tone-project.ts';
import { installLiveOutputObserver, waitForLiveOutputObserver } from './helpers/live-output-observer.js';

// Permit the test-only blob worklet without changing the shipped script policy.
test.use({ browserCoverage: false, bypassCSP: true });

test('a live Click Removal threshold edit preserves the already audible clean recording', async ({ page }) => {
	await installLiveOutputObserver(page, '__round6ClickOutput');
	const editor = await bootEditor(page, '/embed/en/');
	const { projectId, file } = await liveEffectToneProject();
	await editor.locator('[data-aup4-input]').setInputFiles(file);
	await expect(editor).toHaveAttribute('data-project-id', projectId);
	await waitForProjectActivation(editor);
	const panel = await openEffectsForTrack(editor, 0);
	await addRackEffect(page, panel, 'track', 'Click Removal');
	const dialog = page.getByRole('dialog', { name: 'Click Removal', exact: true });
	const threshold = dialog.locator('[data-effect-param="threshold"] input[type="number"]');
	await waitForLiveOutputObserver(page);
	await editor.getByRole('button', { name: 'Play', exact: true }).click();
	await expect.poll(() => page.evaluate(() => window.__round6ClickOutput.some(sample => sample.rms > .2))).toBe(true);
	const healthyAt = await page.evaluate(() => window.__round6ClickOutput.at(-1).time);
	await expect.poll(() => page.evaluate(time => window.__round6ClickOutput.at(-1).time - time, healthyAt)).toBeGreaterThan(.3);
	const healthy = await page.evaluate(time => window.__round6ClickOutput.filter(sample => sample.time > time), healthyAt);
	expect(Math.min(...healthy.map(sample => sample.rms))).toBeGreaterThan(.2);
	const changedAt = await page.evaluate(() => window.__round6ClickOutput.at(-1).time);
	await commitInput(threshold, '201');
	await expect(threshold).toHaveValue('201');
	await expect.poll(() => page.evaluate(time => window.__round6ClickOutput.at(-1).time - time, changedAt)).toBeGreaterThan(.6);
	const changed = await page.evaluate(time => window.__round6ClickOutput.filter(sample => sample.time > time), changedAt);
	console.log('ordinary live Click Removal edit native output', {
		beforeMinimumRms: Math.min(...healthy.map(sample => sample.rms)),
		afterMinimumRms: Math.min(...changed.map(sample => sample.rms)),
		lostFrames: changed.filter(sample => sample.rms < .01).length * 256,
	});
	expect(Math.min(...changed.map(sample => sample.rms))).toBeGreaterThan(.2);
	await editor.getByRole('button', { name: 'Stop', exact: true }).click();
});
