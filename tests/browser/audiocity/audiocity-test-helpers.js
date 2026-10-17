/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect } from '../audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, chooseNestedCommandAction } from '../audio-editor-test-helpers.js';

export const providerOrigin = `http://127.0.0.1:${process.env.SCAPE_AUDIOCITY_PORT || '8091'}`;

export async function connect(page, { format } = {}) {
	if (format) await page.route('**/api/audiocom/usage', async route => {
		const response = await route.fetch();
		const body = await response.json();
		body.data.projectFormats = [format];
		await route.fulfill({ response, json: body });
	});
	const editor = await bootEditor(page, '/embed/en/');
	const panel = editor.locator('[data-workspace-panel="audiocom"]');
	await expect(panel).toHaveCount(0);
	await chooseCommandAction(page, editor, 'Edit', 'Preferences');
	const preferences = page.getByRole('dialog', { name: 'Editor preferences', exact: true });
	await preferences.getByRole('tab', { name: /Advanced$/u }).click();
	const server = preferences.getByRole('textbox', { name: 'Server URL', exact: true });
	await expect(server).toHaveValue('https://api.audio.com');
	await server.fill(providerOrigin);
	await preferences.getByRole('button', { name: 'Save server', exact: true }).click();
	await expect(preferences.getByRole('button', { name: 'Save server', exact: true })).toBeDisabled();
	await preferences.getByRole('button', { name: 'Close', exact: true }).last().click();
	await chooseNestedCommandAction(page, editor, 'Window', ['audio.com']);
	await expect(panel.getByRole('button', { name: 'Connect to Audiocity', exact: true })).toBeVisible();
	await expect(panel).toContainText(providerOrigin);
	await authorize(page, panel);
	return { editor, panel };
}


export async function authorize(page, panel, { wrongPassword = false } = {}) {
	const popupEvent = page.waitForEvent('popup');
	await panel.getByRole('button', { name: 'Connect to Audiocity', exact: true }).click();
	const authorization = await popupEvent;
	await expect(authorization).toHaveURL(new RegExp(`^${providerOrigin}/auth/authorize\\?`, 'u'));
	await authorization.getByLabel('Email', { exact: true }).fill('soundscaper-validation@example.test');
	if (wrongPassword) {
		await authorization.getByLabel('Password', { exact: true }).fill('incorrect-password');
		await authorization.getByRole('button', { name: 'Allow access', exact: true }).click();
		await expect(authorization.getByText('Invalid email or password.', { exact: true })).toBeVisible();
		await expect(panel.getByText('Connected to Audiocity', { exact: true })).toHaveCount(0);
	}
	await authorization.getByLabel('Email', { exact: true }).fill('soundscaper-validation@example.test');
	await authorization.getByLabel('Password', { exact: true }).fill('soundscaper-audiocity-test-only-password');
	await authorization.getByRole('button', { name: 'Allow access', exact: true }).click();
	await expect(panel.getByText('Connected to Audiocity', { exact: true })).toBeVisible();
}
