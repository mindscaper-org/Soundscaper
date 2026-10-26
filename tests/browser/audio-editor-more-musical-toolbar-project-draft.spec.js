/* SPDX-License-Identifier: AGPL-3.0-only */
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, registerAudioEditorHooks } from './audio-editor-test-helpers.js';
import { createSoundscaperProject } from '../../src/soundscaper/editor-project.ts';
import { exportScapeProject, SCAPE_MIME_TYPE } from '../../src/common/editor/scape-project.js';
registerAudioEditorHooks();

/** @param {string} id */
async function projectFile(id) {
	const project = createSoundscaperProject({ id, title: id });
	const result = await exportScapeProject(project, { async getMediaAssetMetadata() { return null; },
		async loadMediaAsset() { return null; }, readSourceChunks() { return (async function* empty() {})(); } });
	expect(result.blob).toBeInstanceOf(Blob);
	return Buffer.from(await result.blob.arrayBuffer()).toString('base64');
}
/** @param {import('@playwright/test').Page} page @param {string} content */
async function launch(page, content) {
	await page.evaluate(({ bytes, mimeType }) => {
		const binary = Uint8Array.from(atob(bytes), character => character.charCodeAt(0));
		globalThis.__moreMusicalLaunch({ files: [{ kind: 'file', getFile: () => Promise.resolve(new File([binary], 'programme.sscape', { type: mimeType })) }] });
	}, { bytes: content, mimeType: SCAPE_MIME_TYPE });
}

test('an OS-launched project retires a focused musical toolbar tempo draft', async ({ page }) => {
	await page.addInitScript(() => Object.defineProperty(globalThis, 'launchQueue', {
		configurable: true, value: { setConsumer(consumer) { globalThis.__moreMusicalLaunch = consumer; } },
	}));
	const editor = await bootEditor(page, '/en/');
	await page.locator('[data-sidebar] [data-workspace-select]').selectOption('music');
	await launch(page, await projectFile('tempo-outgoing'));
	await expect(editor).toHaveAttribute('data-project-id', 'tempo-outgoing');
	const tempo = editor.locator('[data-action-id="playback-bpm"] input');
	await tempo.fill('200');
	await expect(tempo).toBeFocused();
	await launch(page, await projectFile('tempo-incoming'));
	await expect(editor).toHaveAttribute('data-project-id', 'tempo-incoming');
	await expect(tempo).toHaveValue('120');
	await tempo.press('Tab');
	await expect(tempo).toHaveValue('120');
});
