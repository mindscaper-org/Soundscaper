/* SPDX-License-Identifier: AGPL-3.0-only */
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, chooseNestedCommandAction, disableNativeSavePicker } from './audio-editor-test-helpers.js';
import { exportSamples } from './helpers/round2-audio-export.js';
import { persistedProject } from './helpers/complex-editing-workflows.js';
import { routeRippleProject } from '../helpers/next-route-ripple-project.ts';
import { exportScapeProject } from '../../src/common/editor/scape-project.js';
import { createProjectStore } from '../../src/common/editor/storage.js';

test('Repeat across every track carries the global Master automation with the later programme', async ({ page }) => {
	const { project, source } = routeRippleProject();
	const store = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: `next-project-fixture-${crypto.randomUUID()}` }); let blob;
	try {
		const writer = await store.beginSourceWrite(source.storageKey, source);
		await writer.write([new Float32Array(source.frameCount).fill(.25)]); await writer.commit();
		blob = (await exportScapeProject(project, store)).blob;
	} finally { await store.close(); }
	await disableNativeSavePicker(page); const editor = await bootEditor(page, '/embed/en/');
	await editor.locator('[data-aup4-input]').setInputFiles({ name: 'Programme.sscape', mimeType: 'application/zip', buffer: Buffer.from(await blob.arrayBuffer()) });
	await expect(editor).toHaveAttribute('data-project-id', project.id);
	await expect(editor).not.toHaveAttribute('data-edit-block-reason', 'read-only');
	await chooseCommandAction(page, editor, 'Select', 'Select all');
	const field = editor.getByRole('group', { name: 'Selection end', exact: true });
	await field.locator('.timecode__format-button').click();
	await page.getByRole('menuitem', { name: 'samples', exact: true }).click();
	const digits = field.locator('.timecode-digit'); await digits.first().click();
	await page.keyboard.type('000000048000'); await page.keyboard.press('Enter');
	await expect.poll(async () => Number((await digits.allTextContents()).join(''))).toBe(48_000);
	await chooseNestedCommandAction(page, editor, 'Effect', ['Special', 'Repeat']);
	const dialog = page.getByRole('dialog', { name: 'Apply effect', exact: true });
	await dialog.getByRole('spinbutton', { name: 'Number of repeats', exact: true }).fill('1');
	await dialog.getByRole('button', { name: 'Apply to selection', exact: true }).click(); await expect(dialog).toBeHidden();
	const output = await exportSamples(page, editor);
	expect(output[72_000]).toBeCloseTo(.5 * Math.SQRT1_2, 5);
	await expect.poll(async () => (await persistedProject(page, project.id))?.automationLanes.find(lane => lane.id === 'master-gain')?.points.at(-1)?.position).toBe(240_000);
	await chooseCommandAction(page, editor, 'Edit', 'Undo');
	await expect.poll(async () => (await persistedProject(page, project.id))?.automationLanes.find(lane => lane.id === 'master-gain')?.points.at(-1)?.position).toBe(192_000);
});
