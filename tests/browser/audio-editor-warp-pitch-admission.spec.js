/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, createWavFixture } from './audio-editor-test-fixtures.js';
import {
	bootEditor, chooseNestedCommandAction, clipByName, clipField, closeClipProperties,
	collectClientErrors, commitInput, disableNativeSavePicker, importFiles, openClipProperties,
} from './audio-editor-test-helpers.js';
import { exportSamples } from './helpers/round2-audio-export.js';
import { persistedProject } from './helpers/complex-editing-workflows.js';
import { chooseClipMediaSetting, expectClipMediaSettingChecked } from './audio-editor-clip-settings-test-helpers.js';

const reason = 'Independent pitch editing is unavailable while an audio warp map controls playback.';

test('ordinary independent Pitch still changes the delivered tone', async ({ page }) => {
	const { editor, clip, errors } = await setup(page);
	const panel = await openClipProperties(page, editor, clip);
	await expectClipMediaSettingChecked(panel, 'Link pitch and tempo', false);
	await expect(clipField(panel, 'pitchCents')).toBeEnabled();
	await commitInput(clipField(panel, 'pitchCents'), '12');
	await closeClipProperties(panel);
	expect(Math.abs(toneFrequency(await exportSamples(page, editor)) - 880)).toBeLessThan(5);
	expect(errors).toEqual([]);
});

test('the pitch keyboard entry explains unavailable independent Pitch for an authored warp', async ({ page }) => {
	const { editor, clip, projectId, errors } = await setup(page, true);
	await clip.locator('.clip-header').click();
	await page.keyboard.press('Control+Shift+P');
	const panel = editor.locator('[data-workspace-panel="clip-properties"]');
	await expect(panel).toBeVisible();
	await expectClipMediaSettingChecked(panel, 'Link pitch and tempo', false);
	await expect(clipField(panel, 'pitchCents')).toBeDisabled();
	await expect(panel.getByRole('group', { name: 'Pitch', exact: true })).toHaveAttribute('title', reason);
	await expect(clipField(panel, 'speedRatio')).toBeEnabled();
	await closeClipProperties(panel);
	expect(Math.abs(toneFrequency(await exportSamples(page, editor)) - 440)).toBeLessThan(5);
	const saved = await persistedProject(page, projectId);
	expect(saved.clips[0].pitchCents).toBe(0);
	expect(saved.clips[0].warpMap.points).toHaveLength(2);
	expect(errors).toEqual([]);
});

for (const bake of [false, true]) {
	test(`linked warped Pitch remains audible${bake ? ' and Render restores independent Pitch' : ''}`, async ({ page }) => {
		const { editor, clip, projectId, errors } = await setup(page, true);
		const panel = await openClipProperties(page, editor, clip);
		await chooseClipMediaSetting(panel, 'Link pitch and tempo');
		await expectClipMediaSettingChecked(panel, 'Link pitch and tempo', true);
		await expect(clipField(panel, 'pitchCents')).toBeEnabled();
		await commitInput(clipField(panel, 'pitchCents'), '12');
		await closeClipProperties(panel);
		expect(Math.abs(toneFrequency(await exportSamples(page, editor)) - 880)).toBeLessThan(5);
		if (bake) {
			await clip.getByRole('button', { name: 'Clip menu', exact: true }).click();
			await page.locator('.audio-editor-clip-context-menu').getByRole('menuitem', { name: 'Render pitch and speed', exact: true }).click();
			const rendered = clipByName(editor, 'warp-pitch-440.wav — Render pitch and speed');
			await expect(rendered).toBeVisible();
			await expect.poll(async () => {
				const saved = await persistedProject(page, projectId);
				return [saved.clips[0].pitchCents, saved.clips[0].speedRatio, saved.clips[0].warpMap ?? null];
			}).toEqual([0, 1, null]);
			const bakedPanel = await openClipProperties(page, editor, rendered);
			await expectClipMediaSettingChecked(bakedPanel, 'Link pitch and tempo', false);
			await expect(clipField(bakedPanel, 'pitchCents')).toBeEnabled();
			await commitInput(clipField(bakedPanel, 'pitchCents'), '12');
			await closeClipProperties(bakedPanel);
			await expect.poll(async () => (await persistedProject(page, projectId)).clips[0].pitchCents).toBe(1_200);
			expect(Math.abs(toneFrequency(await exportSamples(page, editor)) - 1_760)).toBeLessThan(8);
		}
		expect(errors).toEqual([]);
	});
}

async function setup(page, warped = false) {
	await disableNativeSavePicker(page);
	const errors = collectClientErrors(page);
	const editor = await bootEditor(page, '/embed/en/');
	const file = createWavFixture({ name: 'warp-pitch-440.wav', frequency: 440, duration: 1, channelCount: 1 });
	await importFiles(editor, [file]);
	const projectId = await editor.getAttribute('data-project-id');
	const clip = clipByName(editor, file.name);
	await clip.locator('.clip-header').click();
	if (warped) {
		await chooseNestedCommandAction(page, editor, 'Effect', ['Pitch and tempo', 'Audio warp and transients']);
		const warp = page.getByRole('dialog', { name: 'Audio warp and transients', exact: true });
		await warp.getByRole('button', { name: 'Create identity warp map', exact: true }).click();
		await expect(warp).toContainText('Identity warp map created.');
		await warp.getByRole('button', { name: 'Close', exact: true }).click();
	}
	return { editor, clip, projectId, errors };
}

function toneFrequency(samples) {
	const crossings = [];
	for (let frame = 4_801; frame < Math.min(samples.length, 19_200); frame++) {
		if (samples[frame - 1] <= 0 && samples[frame] > 0) crossings.push(frame);
	}
	expect(crossings.length).toBeGreaterThan(20);
	return (crossings.length - 1) * 48_000 / (crossings.at(-1) - crossings[0]);
}
