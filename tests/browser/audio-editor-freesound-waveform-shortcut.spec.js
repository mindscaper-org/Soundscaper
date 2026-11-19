/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, toneA } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, chooseNestedCommandAction, importFiles } from './audio-editor-test-helpers.js';

const SOUND = {
	id: 42, name: 'Rain in the garden', pageUrl: 'https://freesound.org/s/42/',
	creator: { username: 'field-recorder', pageUrl: 'https://freesound.org/people/field-recorder/' },
	description: 'A garden field recording.', tags: ['rain'], category: null, subcategory: null,
	createdAt: '2026-01-02T03:04:05Z', generativeAiPreference: null, explicit: false,
	license: { code: 'cc0', name: 'Creative Commons 0', url: 'https://creativecommons.org/publicdomain/zero/1.0/',
		requiresAttribution: false, commercialUseAllowed: true },
	durationSeconds: 0.8, originalFile: { format: 'wav', channels: 1, byteLength: 1_152_044,
		sampleRate: 48_000, md5: '0123456789abcdef0123456789abcdef' },
	statistics: { downloads: 42, averageRating: 4.75, ratingCount: 8 },
	waveform: { available: true, url: '/api/freesound/sounds/42/waveform?asset=789&source=cdn' },
	preview: { available: true, format: 'ogg', quality: 'high', approximateBitrateKbps: 192 },
};

test('Freesound waveform releases an assigned modified endpoint command', async ({ page }) => {
	await page.route('**/api/freesound/**', async route => {
		const path = new URL(route.request().url()).pathname;
		if (path.endsWith('/oauth/session')) return route.fulfill({ json: { data: { connected: false } } });
		if (path.endsWith('/search')) return route.fulfill({ json: { data: { query: 'rain', page: 1, pageSize: 20,
			totalCount: 1, totalPages: 1, hasNextPage: false, hasPreviousPage: false, results: [SOUND] } } });
		if (path.endsWith('/preview')) return route.fulfill({ contentType: 'audio/wav', body: toneA.buffer });
		if (path.endsWith('/waveform')) return route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="20"><path d="M0 10H100" stroke="black"/></svg>' });
		return route.fulfill({ status: 404, body: '' });
	});
	const editor = await bootEditor(page, '/embed/en/', { showProjectBin: false });
	await importFiles(editor, [toneA]);
	await chooseCommandAction(page, editor, 'Edit', 'Preferences');
	const preferences = page.getByRole('dialog', { name: 'Editor preferences', exact: true });
	await preferences.getByRole('tab', { name: /Keyboard shortcuts$/u }).click();
	await preferences.getByRole('searchbox', { name: 'Search commands', exact: true }).fill('New label track');
	const command = preferences.getByRole('group', { name: 'New label track', exact: true }).locator('..');
	await command.getByRole('textbox').first().fill('Ctrl+Alt+End');
	await command.getByRole('button', { name: 'Assign', exact: true }).click();
	await expect(command.getByRole('button', { name: 'Assign', exact: true })).toBeDisabled();
	await preferences.getByRole('button', { name: 'Close', exact: true }).last().click();
	await editor.getByRole('group', { name: 'Playhead', exact: true }).focus();
	await page.keyboard.press('Control+Alt+End');
	await expect(editor.locator('[data-label-track]')).toHaveCount(1);
	await editor.getByRole('button', { name: 'Undo', exact: true }).click();
	await expect(editor.locator('[data-label-track]')).toHaveCount(0);
	await chooseNestedCommandAction(page, editor, 'Window', ['Freesound']);
	const panel = editor.locator('[data-workspace-panel="freesound"]');
	await panel.getByRole('searchbox', { name: 'Search Freesound', exact: true }).fill('rain');
	await panel.getByRole('button', { name: 'Search', exact: true }).click();
	const waveform = panel.getByRole('slider', { name: 'Seek and play preview: Rain in the garden', exact: true });
	await expect(waveform).toBeVisible();
	await waveform.focus();
	await waveform.press('Control+Alt+End');
	await expect(editor.locator('[data-label-track]')).toHaveCount(1);
});
