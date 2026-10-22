/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, registerAudioEditorHooks } from './audio-editor-test-helpers.js';
import { mockFreesoundApi } from './helpers/guide-freesound.js';
import { createSoundscaperProject } from '../../src/soundscaper/editor-project.ts';
import { exportScapeProject, SCAPE_MIME_TYPE } from '../../src/common/editor/scape-project.js';

registerAudioEditorHooks();

test('a newly launched project retires the previous Freesound fallback choice', async ({ page }) => {
	await mockFreesoundApi(page);
	await page.route('**/api/freesound/oauth/session', route => route.fulfill({ json: { data: { connected: true, user: { id: 7, username: 'recorder' } } } }));
	await page.route('**/api/freesound/uploads/pending', route => route.fulfill({ json: { data: { pendingDescription: [], pendingProcessing: [], pendingModeration: [] } } }));
	await page.route('**/api/freesound/sounds/*/original?*', route => route.fulfill({ status: 413, json: {} }));
	await page.addInitScript(() => Object.defineProperty(globalThis, 'launchQueue', {
		configurable: true, value: { setConsumer(consumer) { globalThis.__moreFreesoundFileLaunch = consumer; } },
	}));
	const editor = await bootEditor(page, '/embed/en/');
	await chooseCommandAction(page, editor, 'Window', 'Freesound');
	const panel = editor.locator('[data-workspace-panel="freesound"]');
	await expect(panel.getByText('Connected as recorder', { exact: true })).toBeVisible();
	await panel.getByRole('searchbox', { name: 'Search Freesound', exact: true }).fill('harbor');
	await panel.getByRole('button', { name: 'Search', exact: true }).click();
	await panel.getByRole('button', { name: /^Add to project\s*:\s*Harbor ambience$/u }).click();
	const fallback = page.locator('[data-freesound-original-fallback-dialog="true"]');
	await expect(fallback).toBeVisible();
	const project = createSoundscaperProject({ id: 'freesound-replacement-project', title: 'Replacement', tracks: [], clips: [], sources: [] });
	const archive = await exportScapeProject(project, {
		async getMediaAssetMetadata() { return null; }, async loadMediaAsset() { return null; },
		readSourceChunks() { return (async function* empty() {})(); },
	});
	expect(archive.blob).toBeInstanceOf(Blob);
	const base64 = Buffer.from(await archive.blob.arrayBuffer()).toString('base64');
	await page.evaluate(({ bytes, mimeType }) => {
		const binary = Uint8Array.from(atob(bytes), character => character.charCodeAt(0));
		globalThis.__moreFreesoundFileLaunch({ files: [{ kind: 'file', getFile: () => Promise.resolve(new File([binary], 'replacement.sscape', { type: mimeType })) }] });
	}, { bytes: base64, mimeType: SCAPE_MIME_TYPE });
	await expect(editor).toHaveAttribute('data-project-id', project.id, { timeout: 15_000 });
	await expect(fallback).toBeHidden();
	await expect(editor).toHaveAttribute('data-clip-count', '0');
});
