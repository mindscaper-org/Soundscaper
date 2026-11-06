/* SPDX-License-Identifier: AGPL-3.0-only */
import { strFromU8, unzipSync } from 'fflate';
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseNestedCommandAction, chooseExportProjectFileAction, disableNativeSavePicker, downloadBytes, waitForProjectActivation } from './audio-editor-test-helpers.js';
import { createFramescaperProject } from '../../src/framescaper/editor-project.ts';
import { FRAMESCAPER_PROJECT_RUNTIME_PROFILE } from '../../src/framescaper/editor-project-runtime-profile.ts';
import { createFramescaperScapeNativeRuntime } from '../../src/framescaper/editor-scape-native.ts';
import { createProjectStore } from '../../src/common/editor/storage.js';
for (const name of ['Opening Room', 'Opening\nRoom', 'Opening\r\nRoom', '  Opening Room  ']) test(`native sequence name survives an unchanged focus/blur: ${JSON.stringify(name)}`, async ({ page }) => {
	const project = createFramescaperProject(FRAMESCAPER_PROJECT_RUNTIME_PROFILE, {
		id: `sequence-name-${Buffer.from(name).toString('hex')}`, sampleRate: 48000,
		primarySequenceId: 'main', sequences: [{ id: 'main', name, trackIds: [] }],
	});
	expect(project.sequences[0].name).toBe(name);
	const store = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: crypto.randomUUID() });
	let blob;
	try { blob = (await createFramescaperScapeNativeRuntime(FRAMESCAPER_PROJECT_RUNTIME_PROFILE).exportScapeProject(project, store)).blob; }
	finally { await store.close(); }
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/framescaper/en/');
	await editor.locator('[data-aup4-input]').setInputFiles({ name: 'Sequence.fscape', mimeType: 'application/zip', buffer: Buffer.from(await blob.arrayBuffer()) });
	await expect(editor).toHaveAttribute('data-project-id', project.id);
	await waitForProjectActivation(editor);
	await chooseNestedCommandAction(page, editor, 'File', ['Project management', 'Project properties']);
	await editor.getByRole('tab', { name: 'Sequence timing', exact: true }).click();
	const field = editor.getByRole('textbox', { name: 'Sequence name', exact: true });
	await field.focus();
	await field.press('Tab');
	expect(await savedSequenceName(page, editor)).toBe(name);
	if (name.includes('\n')) {
		await field.fill('Renamed\nRoom');
		await field.press('Shift+Enter');
		await expect(field).toBeFocused();
		await field.press('Escape');
		await expect(field).toHaveValue(name.replaceAll('\r\n', '\n'));
		await field.fill('Renamed\nRoom');
		await field.press('Enter');
		await editor.getByRole('button', { name: 'Undo', exact: true }).click();
		await expect(field).toHaveValue(name.replaceAll('\r\n', '\n'));
		await editor.getByRole('button', { name: 'Redo', exact: true }).click();
		await expect(field).toHaveValue('Renamed\nRoom');
		expect(await savedSequenceName(page, editor)).toBe('Renamed\nRoom');
	}
});

async function savedSequenceName(page, editor) {
	const downloading = page.waitForEvent('download');
	await chooseExportProjectFileAction(page, editor);
	const saved = JSON.parse(strFromU8(unzipSync(await downloadBytes(await downloading))['project.json']));
	return saved.sequences[0].name;
}
