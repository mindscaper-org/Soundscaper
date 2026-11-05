/* SPDX-License-Identifier: AGPL-3.0-only */
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, chooseExportProjectFileAction, disableNativeSavePicker, downloadBytes, waitForProjectActivation } from './audio-editor-test-helpers.js';
import { createSoundscaperProject } from '../../src/soundscaper/editor-project.ts';
import { createSoundscaperScapeNativeRuntime } from '../../src/soundscaper/editor-scape-native.ts';
import { createProjectStore } from '../../src/common/editor/storage.js';
import { strFromU8, unzipSync } from 'fflate';

for (const [label, original] of [['single line', 'Opening room tone'], ['LF', 'Opening\nRoom tone'], ['CRLF', 'Opening\r\nRoom tone']]) {
	test(`routing form preserves an untouched ${label} name when another field changes`, async ({ page }) => {
		const base = createSoundscaperProject({ id: `routing-name-${label}` });
		const project = createSoundscaperProject({ ...base, mixer: { ...base.mixer,
			vcas: [{ id: 'vca', name: original, gain: .5, mute: false, members: [] }] } });
		const store = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: crypto.randomUUID() });
		let archive;
		try { archive = (await createSoundscaperScapeNativeRuntime().exportScapeProject(project, store)).blob; }
		finally { await store.close(); }
		await disableNativeSavePicker(page);
		const editor = await bootEditor(page, '/embed/en/');
		await editor.locator('[data-aup4-input]').setInputFiles({ name: 'Routing.sscape', mimeType: 'application/zip', buffer: Buffer.from(await archive.arrayBuffer()) });
		await expect(editor).toHaveAttribute('data-project-id', project.id);
		await waitForProjectActivation(editor);
		await chooseCommandAction(page, editor, 'Window', 'Mixer');
		const mixer = editor.locator('[data-mixer-panel]');
		await mixer.getByRole('button', { name: 'Routing graph', exact: true }).click();
		const graph = mixer.locator('[data-soundscaper-routing-graph]');
		await graph.locator('[data-routing-node="vca:vca"] .kw-routing-graph__node-main').click();
		const inspector = graph.locator('[data-routing-inspector="vca"]');
		const name = inspector.getByRole('textbox', { name: 'Name', exact: true });
		const displayed = original.replace(/\r\n?/gu, '\n');
		await expect(name).toHaveValue(displayed);
		await expect(name).toHaveAttribute('maxlength', '1024');
		await inspector.getByLabel('Gain', { exact: true }).fill('.75');
		await inspector.getByRole('button', { name: 'Save VCA', exact: true }).click();
		let saved = await exportProject(page, editor);
		expect(saved.mixer.vcas[0].gain).toBe(.75);
		expect(saved.mixer.vcas[0].name).toBe(original);

		await name.focus(); await name.press('ControlOrMeta+End');
		if (label !== 'single line') await name.press('Shift+Enter');
		await name.pressSequentially(' encore ');
		await name.press('Enter');
		await expect(name).toBeFocused();
		saved = await exportProject(page, editor);
		expect(saved.mixer.vcas[0].name).toBe(displayed + (label !== 'single line' ? '\n' : '') + ' encore ');
	});
}

async function exportProject(page, editor) {
	const downloading = page.waitForEvent('download');
	await chooseExportProjectFileAction(page, editor);
	return JSON.parse(strFromU8(unzipSync(await downloadBytes(await downloading))['project.json']));
}
