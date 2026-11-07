/* SPDX-License-Identifier: AGPL-3.0-only */

import { createWavFixture, expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, clipByName, importFiles, openSourceMonitor } from './audio-editor-test-helpers.js';

test.skip(({ browserName }) => browserName !== 'chromium', 'Chromium provides the native speaker-device fixture.');
test.use({ launchOptions: { args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] } });

test('a late Speakers choice cannot retarget Source playback away from the current main output', async ({ page }) => {
	await page.context().grantPermissions(['microphone']);
	await page.addInitScript(() => {
		const Original = AudioContext;
		window.__auditionOutputSelection = { contexts: [], target: '', held: false, release: null, completed: [] };
		window.AudioContext = new Proxy(Original, { construct(target, args) {
			const context = Reflect.construct(target, args);
			window.__auditionOutputSelection.contexts.push(context);
			return context;
		} });
		const originalSink = Original.prototype.setSinkId;
		Original.prototype.setSinkId = async function (deviceId) {
			const index = window.__auditionOutputSelection.contexts.indexOf(this);
			if (index === 0 && deviceId && deviceId === window.__auditionOutputSelection.target) {
				window.__auditionOutputSelection.target = '';
				window.__auditionOutputSelection.held = true;
				await new Promise(resolve => { window.__auditionOutputSelection.release = resolve; });
			}
			await originalSink.call(this, deviceId);
			window.__auditionOutputSelection.completed.push({ index, deviceId });
		};
	});
	const editor = await bootEditor(page, '/embed/en/');
	const recording = createWavFixture({ name: 'speaker-selection.wav', frequency: 440, duration: 10, channelCount: 1 });
	await importFiles(editor, [recording]);
	await editor.getByRole('button', { name: 'Play', exact: true }).click();
	await editor.getByRole('button', { name: 'Stop', exact: true }).click();
	const source = await openSourceMonitor(page, editor, clipByName(editor, recording.name));
	await source.getByRole('button', { name: 'Play', exact: true }).click();
	await expect(source.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
	await expect.poll(() => page.evaluate(() => window.__auditionOutputSelection.contexts.length)).toBe(2);
	await editor.getByRole('button', { name: 'Audio setup', exact: true }).click();
	const speakers = editor.getByRole('dialog', { name: 'Audio setup', exact: true })
		.getByRole('combobox', { name: 'Speakers', exact: true });
	const older = await speakers.getByRole('option', { name: 'Fake Audio Output 1', exact: true }).getAttribute('value');
	const current = await speakers.getByRole('option', { name: 'Fake Audio Output 2', exact: true }).getAttribute('value');
	expect(older).toBeTruthy();
	expect(current).toBeTruthy();
	await page.evaluate(value => { window.__auditionOutputSelection.target = value; }, older);
	await speakers.selectOption(older);
	await expect.poll(() => page.evaluate(() => window.__auditionOutputSelection.held)).toBe(true);
	await expect(speakers).toBeEnabled();
	await speakers.selectOption(current);
	await expect.poll(() => page.evaluate(() => window.__auditionOutputSelection.contexts.map(context => context.sinkId)))
		.toEqual([current, current]);
	await page.evaluate(() => { window.__auditionOutputSelection.release(); });
	// Wait for the stale main-output switch and its repair; Source already uses
	// the current sink and must not need another physical switch to retain it.
	await expect.poll(() => page.evaluate(() => window.__auditionOutputSelection.completed
		.filter(route => route.index === 0).slice(-2).map(route => route.deviceId)))
		.toEqual([older, current]);
	await expect(speakers).toHaveValue(current);
	await expect.poll(() => page.evaluate(() => window.__auditionOutputSelection.contexts.map(context => context.sinkId)))
		.toEqual([current, current]);
	await expect(source.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
});
