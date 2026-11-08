/* SPDX-License-Identifier: AGPL-3.0-only */
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, chooseExportProjectFileAction, disableNativeSavePicker, downloadBytes, waitForProjectActivation } from './audio-editor-test-helpers.js';
import { createSoundscaperProject } from '../../src/soundscaper/editor-project.ts';
import { createSoundscaperScapeNativeRuntime } from '../../src/soundscaper/editor-scape-native.ts';
import { createProjectStore } from '../../src/common/editor/storage.js';
import { strFromU8, unzipSync } from 'fflate';

for (const gain of [.5, .123]) test(`native VCA gain ${gain} permits an unrelated name edit`, async ({ page }) => {
	const base = createSoundscaperProject({ id: `vca-precision-${gain}` });
	const project = createSoundscaperProject({ ...base, mixer: { ...base.mixer,
		vcas: [{ id: 'vca-precise', name: 'Dialogue control', gain, mute: false, members: [] }] } });
	const store = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: crypto.randomUUID() });
	let archive;
	try { archive = (await createSoundscaperScapeNativeRuntime().exportScapeProject(project, store)).blob; }
	finally { await store.close(); }
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/embed/en/');
	await editor.locator('[data-aup4-input]').setInputFiles({ name: 'Precise.sscape', mimeType: 'application/zip', buffer: Buffer.from(await archive.arrayBuffer()) });
	await expect(editor).toHaveAttribute('data-project-id', project.id);
	await waitForProjectActivation(editor);
	await chooseCommandAction(page, editor, 'Window', 'Mixer');
	const mixer = editor.locator('[data-mixer-panel]');
	await mixer.getByRole('button', { name: 'Routing graph', exact: true }).click();
	const graph = mixer.locator('[data-soundscaper-routing-graph]');
	const node = graph.locator('[data-routing-node="vca:vca-precise"]');
	await node.locator('.kw-routing-graph__node-main').click();
	const inspector = graph.locator('[data-routing-inspector="vca"]');
	const level = inspector.getByLabel('Gain', { exact: true });
	const name = inspector.getByLabel('Name', { exact: true });
	const save = inspector.getByRole('button', { name: 'Save VCA', exact: true });
	await expect(level).toHaveValue(String(gain));
	await name.fill('Renamed control');
	await save.click();
	await expect(node).toContainText('Renamed control');
	let saved = await exportProject(page, editor);
	expect(saved.mixer.vcas[0].name).toBe('Renamed control');
	expect(saved.mixer.vcas[0].gain).toBe(gain);

	// Keep the existing native hundredth arrows and all range validation.
	await level.fill('.5'); await level.press('ArrowUp');
	await expect(level).toHaveValue('0.51');
	await level.press('ArrowDown'); await expect(level).toHaveValue('0.5');
	await name.fill('Still pending'); await level.fill('4.01'); await save.click();
	await expect(node).toContainText('Renamed control');
	expect(await level.evaluate(input => input.validity.rangeOverflow)).toBe(true);
	await level.fill('.123456789'); await save.click();
	await expect(node).toContainText('Still pending');
	saved = await exportProject(page, editor);
	expect(saved.mixer.vcas[0].gain).toBe(.123456789);
});

async function exportProject(page, editor) {
	const downloading = page.waitForEvent('download');
	await chooseExportProjectFileAction(page, editor);
	return JSON.parse(strFromU8(unzipSync(await downloadBytes(await downloading))['project.json']));
}
