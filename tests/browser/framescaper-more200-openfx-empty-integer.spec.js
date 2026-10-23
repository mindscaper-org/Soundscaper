/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, chooseNestedCommandAction } from './audio-editor-test-helpers.js';
import { openNativePreferences } from './helpers/assistance-task-menu.js';
import { installNativeServicesFixture } from './helpers/framescaper-native-services-fixture.js';
import { FRAMESCAPER_DATABASE_NAME } from './helpers/editor-databases.js';

for (const type of ['integer', 'choice']) test(`OpenFX Add does not reinterpret a cleared ${type} as zero`, async ({ page }) => {
	await installNativeServicesFixture(page, { parameters: [{ name: 'Count', type, animates: false }] });
	const editor = await bootEditor(page, '/framescaper/embed/en/');
	await chooseNestedCommandAction(page, editor, 'Generate', ['Video Generators', 'Add Solid']);
	await expect(editor.getByRole('group', { name: 'Video clip: Solid', exact: true })).toHaveCount(1);
	await openNativePreferences(page, editor, 'Media', 'Native media and scratch');
	let dialog = page.locator('[data-framescaper-native-services-dialog="true"]');
	await dialog.locator('[data-native-service-preference="native-media"]').check();
	await dialog.locator('button').filter({ hasText: /^Close$/u }).click();
	await chooseCommandAction(page, editor, 'Effect', 'Plugin Manager');
	dialog = page.locator('[data-framescaper-native-services-dialog="true"]');
	await dialog.getByText('Scanning & Settings', { exact: true }).click();
	await dialog.getByRole('checkbox', { name: 'Allow OpenFX plugin scanning and execution' }).check();
	await dialog.locator('button').filter({ hasText: /^Close$/u }).click();
	await chooseNestedCommandAction(page, editor, 'Effect', ['Video effects', 'Add OFX']);
	dialog = page.locator('[data-framescaper-native-services-dialog="true"]');
	const form = dialog.locator('[data-framescaper-openfx-add-form="true"]');
	await form.getByRole('textbox', { name: 'Count', exact: true }).fill('');
	await form.getByRole('button', { name: 'Add OpenFX effect', exact: true }).click();
	await expect(form.getByRole('alert')).toContainText(/integer/iu);
	const projectId = await editor.getAttribute('data-project-id');
	expect(await effects(page, projectId)).toHaveLength(0);
	await form.getByRole('textbox', { name: 'Count', exact: true }).fill('0');
	await form.getByRole('button', { name: 'Add OpenFX effect', exact: true }).click();
	await expect(form.getByRole('status')).toContainText('OpenFX effect added.');
	await expect.poll(() => effects(page, projectId)).toMatchObject([{ parameters: [{ name: 'Count', type, value: 0 }] }]);
});

async function effects(page, id) {
	return page.evaluate(async ({ database, id }) => {
		const request = operation => new Promise((resolve, reject) => {
			operation.onsuccess = () => resolve(operation.result); operation.onerror = () => reject(operation.error);
		});
		const db = await request(indexedDB.open(database));
		try { return (await request(db.transaction('projects').objectStore('projects').get(id))).ofxEffects; }
		finally { db.close(); }
	}, { database: FRAMESCAPER_DATABASE_NAME, id });
}
