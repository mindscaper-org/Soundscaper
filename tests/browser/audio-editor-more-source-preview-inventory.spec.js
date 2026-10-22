/* SPDX-License-Identifier: AGPL-3.0-only */

import { createWavFixture, expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, clipByName, clipField, commitInput, importFiles, openClipProperties, openSourceMonitor } from './audio-editor-test-helpers.js';

test('a healthy source can audition while an unrelated pitched recording cannot load its render worker', async ({ page }) => {
	await page.addInitScript(() => {
		const NativeWorker = window.Worker;
		window.Worker = class extends NativeWorker {
			constructor(url, options) {
				if (options?.name === 'audacity-staffpad-render') throw new DOMException('Pitch render worker unavailable offline', 'NetworkError');
				super(url, options);
			}
		};
	});
	const editor = await bootEditor(page, '/embed/en/');
	const healthy = createWavFixture({ name: 'healthy.wav', duration: 1 });
	const pitched = createWavFixture({ name: 'pitched.wav', duration: 1, frequency: 220 });
	await importFiles(editor, [healthy, pitched]);
	const properties = await openClipProperties(page, editor, clipByName(editor, pitched.name));
	await commitInput(clipField(properties, 'pitchCents'), '3');
	const source = await openSourceMonitor(page, editor, clipByName(editor, healthy.name));
	await source.getByRole('button', { name: 'Play', exact: true }).click();
	await expect(source.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
	await expect.poll(async () => Number(await source.getByRole('slider', { name: 'Source timeline', exact: true }).getAttribute('aria-valuenow'))).toBeGreaterThan(0);
	await source.getByRole('button', { name: 'Stop', exact: true }).click();
});
