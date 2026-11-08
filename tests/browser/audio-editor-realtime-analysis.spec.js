/* SPDX-License-Identifier: AGPL-3.0-only */

import { createWavFixture, expect, readFile, test } from './audio-editor-test-fixtures.js';
import {
	bootEditor,
	chooseCommandAction,
	collectClientErrors,
	importFiles,
	registerAudioEditorHooks,
} from './audio-editor-test-helpers.js';
import { waitForLiveAnalysisSignal } from './helpers/performance-paint-readiness.js';

test.describe('realtime Analysis panel', () => {
	registerAudioEditorHooks();

	test('keeps collapsible analyzers responsive during stereo playback', async ({ page }) => {
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/embed/en/');
		await importFiles(editor, [createWavFixture({
			name: 'live-analysis-stereo.wav', frequency: 440, duration: 5, channelCount: 2,
		})]);
		await chooseCommandAction(page, editor, 'Analyze', 'Analysis');
		const panel = editor.locator('[data-workspace-panel="analysis"]');
		await expect(panel.locator('[data-analysis-section]')).toHaveCount(6);
		for (const id of ['loudness', 'spectrum', 'spectrogram', 'correlation']) {
			await panel.locator(`[data-analysis-section="${id}"] summary`).click();
		}
		await expect(panel.locator('[data-live-analysis-spectrum]')).toBeVisible();
		await expect(panel.locator('[data-live-analysis-spectrogram]')).toBeVisible();
		await expect(panel.locator('[data-analysis-jellyfish]')).toBeVisible();

		await editor.getByRole('button', { name: 'Play', exact: true }).click();
		await expect(editor.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
		await expect(panel.locator('[data-analysis-value="correlation"]'))
			.not.toHaveText('—', { timeout: 10_000 });
		await expect.poll(async () => Number(await panel.locator('[data-analysis-value="correlation"]').textContent()))
			.toBeGreaterThan(0.2);
		await expect.poll(async () => Number(await panel.locator('[data-analysis-value="correlation"]').textContent()))
			.toBeLessThan(0.8);
		await waitForLiveAnalysisSignal(panel);
		const blockingTime = await page.evaluate(async () => {
			const durations = [];
			const observer = new PerformanceObserver((list) => {
				for (const entry of list.getEntries()) durations.push(entry.duration);
			});
			observer.observe({ type: 'longtask', buffered: false });
			await new Promise((resolve) => setTimeout(resolve, 500));
			for (const entry of observer.takeRecords()) durations.push(entry.duration);
			observer.disconnect();
			return durations.reduce((total, duration) => total + Math.max(0, duration - 50), 0);
		});
		expect(blockingTime).toBeLessThan(50);
		await panel.locator('[data-analysis-section="spectrogram"] summary').click();
		await expect(panel.locator('[data-live-analysis-spectrogram]')).toHaveCount(0);
		await editor.getByRole('button', { name: 'Stop', exact: true }).click();
		expect(errors).toEqual([]);
	});

	test('checks ACX audio requirements only inside the expanded section', async ({ page }) => {
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/embed/en/');
		await importFiles(editor, [createWavFixture({ name: 'acx-tone.wav', frequency: 440, duration: 0.8 })]);
		await chooseCommandAction(page, editor, 'Analyze', 'Analysis');
		const panel = editor.locator('[data-workspace-panel="analysis"]');
		await expect(panel.getByRole('button', { name: 'Check audio', exact: true })).toHaveCount(0);
		await panel.getByText('ACX compliance', { exact: true }).click();
		await expect(panel.getByText('No audio checked yet.', { exact: true })).toBeVisible();
		await panel.getByRole('button', { name: 'Check audio', exact: true }).click();
		const results = panel.getByRole('table', { name: 'ACX audio checks', exact: true });
		await expect(results).toBeVisible({ timeout: 20_000 });
		await expect(results.getByRole('row', { name: /Peak level/u })).toContainText('Pass');
		await expect(results.getByRole('row', { name: /RMS level/u })).toContainText('Fail');
		await expect(results.getByRole('row', { name: /Estimated noise floor/u })).toContainText('Fail');
		await expect(results.getByRole('row', { name: /Sample rate/u })).toContainText('Fail');
		await expect(panel.getByText('Some audio checks fail.', { exact: true })).toBeVisible();
		const downloadPromise = page.waitForEvent('download');
		await panel.getByRole('button', { name: 'Export', exact: true }).click();
		const download = await downloadPromise;
		expect(download.suggestedFilename()).toMatch(/-acx-compliance\.json$/u);
		const report = JSON.parse(await readFile(await download.path(), 'utf8'));
		expect(report.report).toMatchObject({ type: 'acx-compliance', status: 'fail' });
		expect(report.measurement.noiseFloorDbfs).toBeGreaterThan(-60);
		await panel.getByText('ACX compliance', { exact: true }).click();
		await expect(results).toHaveCount(0);
		await panel.getByText('ACX compliance', { exact: true }).click();
		await expect(panel.getByText('No audio checked yet.', { exact: true })).toBeVisible();
		expect(errors).toEqual([]);
	});
});
