/* SPDX-License-Identifier: AGPL-3.0-only */
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, registerAudioEditorHooks } from './audio-editor-test-helpers.js';
import { createAudioTrack } from '../../src/common/editor/project-media-factory.ts';
import { createSoundscaperProject } from '../../src/soundscaper/editor-project.ts';
import { exportScapeProject, SCAPE_MIME_TYPE } from '../../src/common/editor/scape-project.js';
registerAudioEditorHooks();

/** @param {string} id */
async function projectFile(id) {
	const project = createSoundscaperProject({ id, title: id, tracks: [createAudioTrack({ id: 'voice', name: 'Voice' })] });
	const exported = await exportScapeProject(project, { async getMediaAssetMetadata() { return null; },
		async loadMediaAsset() { return null; }, readSourceChunks() { return (async function* empty() {})(); } });
	expect(exported.blob).toBeInstanceOf(Blob);
	return Buffer.from(await exported.blob.arrayBuffer()).toString('base64');
}
/** @param {import('@playwright/test').Page} page @param {string} content */
async function launch(page, content) {
	await page.evaluate(({ bytes, mimeType }) => {
		const binary = Uint8Array.from(atob(bytes), character => character.charCodeAt(0));
		globalThis.__nextTrackLaunch({ files: [{ kind: 'file', getFile: () => Promise.resolve(new File([binary], 'programme.sscape', { type: mimeType })) }] });
	}, { bytes: content, mimeType: SCAPE_MIME_TYPE });
}

test('an OS-launched native project retires the outgoing inline track name', async ({ page }) => {
	await page.addInitScript(() => Object.defineProperty(globalThis, 'launchQueue', {
		configurable: true, value: { setConsumer(consumer) { globalThis.__nextTrackLaunch = consumer; } },
	}));
	const editor = await bootEditor(page, '/en/');
	await launch(page, await projectFile('track-outgoing'));
	await expect(editor).toHaveAttribute('data-project-id', 'track-outgoing');
	const row = editor.locator('[data-track-row][data-track-id="voice"]');
	await row.locator('.track-control-panel__track-name-text').dblclick();
	const input = row.locator('[data-track-name] input');
	await input.fill('Outgoing draft'); await expect(input).toBeFocused();
	await launch(page, await projectFile('track-incoming'));
	await expect(editor).toHaveAttribute('data-project-id', 'track-incoming');
	if (await input.count()) await input.press('Tab');
	await expect(row.locator('.track-control-panel__track-name-text')).toHaveText('Voice');
});
