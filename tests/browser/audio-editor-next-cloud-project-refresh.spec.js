/* SPDX-License-Identifier: AGPL-3.0-only */
import { AUDIOCOM_COPY_BY_LOCALE } from '../../src/common/i18n/audiocom-copy.ts';

import { expect, test, toneA } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, chooseNestedCommandAction, importFiles } from './audio-editor-test-helpers.js';

test('a completed native cloud save remains visible when the following list request fails', async ({ page }) => {
	test.setTimeout(90_000);
	const origin = 'https://cloud.example.test';
	const projectId = '12345678-1234-4234-8234-123456789abc';
	const snapshotId = 'aaaaaaaa-1234-4234-8234-123456789abc';
	let committed;
	let failListing = true;
	let completed = 0;
	await page.route('**/api/audiocom/**', async route => {
		const request = route.request(), url = new URL(request.url());
		const data = value => route.fulfill({ json: { data: value } });
		if (url.pathname.endsWith('/usage')) return data({ maximumUploadBytes: 100_000_000,
			projectStorageSupported: true, projectFormats: ['aup3'],
			provider: { kind: 'audiocity', apiOrigin: origin, webOrigin: origin, scope: 'all' } });
		if (url.pathname.endsWith('/oauth/session')) return data({ connected: true });
		if (url.pathname.endsWith('/search') || url.pathname.endsWith('/library')) return data({ results: [], page: 1, hasNext: false });
		if (url.pathname.endsWith('/projects')) {
			const phase = url.searchParams.get('phase');
			if (phase === 'prepare') {
				const manifest = request.postDataJSON();
				committed = { id: projectId, snapshotId, name: manifest.name, format: 'aup3', size: 32 };
				return data({ projectId, snapshotId, missing: [] });
			}
			if (phase === 'part') return route.fulfill({ status: 204 });
			if (phase === 'complete') { completed++; return data(committed); }
			if (completed && failListing) return route.fulfill({ status: 503, json: { error: { message: 'The project listing is temporarily unavailable.' } } });
			return data({ results: committed ? [committed] : [], page: 1, hasNext: false });
		}
		return route.fulfill({ status: 404 });
	});
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [toneA]);
	await chooseCommandAction(page, editor, 'Edit', 'Preferences');
	const preferences = page.getByRole('dialog', { name: 'Editor preferences', exact: true });
	await preferences.getByRole('tab', { name: /Advanced$/u }).click();
	await preferences.getByRole('textbox', { name: 'Server URL', exact: true }).fill(origin);
	await preferences.getByRole('button', { name: 'Save server', exact: true }).click();
	await expect(preferences.getByRole('button', { name: 'Save server', exact: true })).toBeDisabled();
	await preferences.getByRole('button', { name: 'Close', exact: true }).last().click();
	await chooseNestedCommandAction(page, editor, 'Window', ['audio.com']);
	const panel = editor.locator('[data-workspace-panel="audiocom"]');
	const archives = panel.locator('[data-audiocom-projects]');
	await archives.locator('summary').click();
	await panel.getByRole('button', { name: 'Save project', exact: true }).click();
	await expect.poll(() => completed).toBe(1);
	await expect(archives.getByRole('status').filter({ hasText: /^Stored .+\.aup3\.$/u })).toBeVisible();
	await expect(panel.getByRole('alert')).toContainText(AUDIOCOM_COPY_BY_LOCALE.en.projectArchiveRefreshFailed);
	failListing = false;
	await archives.getByRole('button', { name: 'Refresh projects', exact: true }).click();
	await expect(archives.locator('[data-audiocom-project-id]')).toHaveAttribute('data-audiocom-project-id', projectId);
	expect(completed).toBe(1);
});
