/* SPDX-License-Identifier: AGPL-3.0-only */
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, chooseNestedCommandAction, clipByName } from './audio-editor-test-helpers.js';
import { zeroCrossingRouteProject } from '../helpers/next-zero-crossing-route-project.ts';
import { findNearestAudioZeroCrossing } from '../../src/common/editor/zero-crossing.js';
import { exportScapeProject } from '../../src/common/editor/scape-project.js';
import { createProjectStore } from '../../src/common/editor/storage.js';

for (const kind of ['reference']) test(`At zero crossings snaps a selection ending at the actual recording tail`, async ({ page }) => {
	const { project, source, samples } = zeroCrossingRouteProject(kind);
	const store = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: `next-project-fixture-${crypto.randomUUID()}` });
	let blob;
	try {
		const writer = await store.beginSourceWrite(source.storageKey, source); await writer.write([samples]); await writer.commit();
		blob = (await exportScapeProject(project, store)).blob;
	} finally { await store.close(); }
	const editor = await bootEditor(page, '/embed/en/');
	await editor.locator('[data-aup4-input]').setInputFiles({ name: 'Crossing route.sscape', mimeType: 'application/zip', buffer: Buffer.from(await blob.arrayBuffer()) });
	await expect(editor).toHaveAttribute('data-project-id', project.id);
	await expect(editor).not.toHaveAttribute('data-edit-block-reason', 'read-only');
	await clipByName(editor, 'Recording').locator('.clip-header').click();
	await chooseNestedCommandAction(page, editor, 'Select', ['Region', 'Track start to end']);
	for (const [edge, value] of [['end', 48_000], ['start', 10_007]]) {
		const field = editor.getByRole('group', { name: `Selection ${edge}`, exact: true });
		await field.locator('.timecode__format-button').click(); await page.getByRole('menuitem', { name: 'samples', exact: true }).click();
		const digits = field.locator('.timecode-digit'); await expect(digits).toHaveCount(12); await digits.first().click();
		await page.keyboard.type(String(value).padStart(12, '0')); await page.keyboard.press('Enter');
		await expect.poll(async () => Number((await digits.allTextContents()).join(''))).toBe(value);
	}
	await chooseCommandAction(page, editor, 'Select', 'At zero crossings');
	await expect(editor.locator('[data-status]')).toHaveText(/zero crossings/iu);
	const expected = [10_007, 48_000].map(frame => findNearestAudioZeroCrossing([samples], frame, { maximumDistance: 480 }));
	expect(expected[0]).not.toBe(10_007); expect(expected[1]).not.toBe(48_000);
	for (const [index, edge] of ['start', 'end'].entries()) await expect.poll(async () => Number((await editor
		.getByRole('group', { name: `Selection ${edge}`, exact: true }).locator('.timecode-digit').allTextContents()).join(''))).toBe(expected[index]);
});
