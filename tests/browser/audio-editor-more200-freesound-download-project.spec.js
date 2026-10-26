/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, disableNativeSavePicker } from './audio-editor-test-helpers.js';
import { mockFreesoundApi } from './helpers/guide-freesound.js';
import { createSoundscaperProject } from '../../src/soundscaper/editor-project.ts';
import { exportScapeProject, SCAPE_MIME_TYPE } from '../../src/common/editor/scape-project.js';
import { exportSamples } from './helpers/round2-audio-export.js';

test('a launched project can import Freesound audio before the outgoing download completes', async ({ page }) => {
	await disableNativeSavePicker(page);
	await mockFreesoundApi(page);
	let release;
	const pending = new Promise(resolve => { release = resolve; });
	let requested;
	const started = new Promise(resolve => { requested = resolve; });
	let downloads = 0;
	await page.route('**/api/freesound/sounds/*/preview*', async route => {
		if (++downloads === 1) { requested(); await pending; }
		await route.fallback();
	});
	await page.addInitScript(() => Object.defineProperty(globalThis, 'launchQueue', {
		configurable: true, value: { setConsumer(consumer) { globalThis.__freesoundDownloadLaunch = consumer; } },
	}));
	try {
		const editor = await bootEditor(page, '/embed/en/');
		await chooseCommandAction(page, editor, 'Window', 'Freesound');
		const panel = editor.locator('[data-workspace-panel="freesound"]');
		await panel.getByRole('searchbox', { name: 'Search Freesound', exact: true }).fill('harbor');
		await panel.getByRole('button', { name: 'Search', exact: true }).click();
		const add = panel.getByRole('button', { name: /^Add to project\s*:\s*Harbor ambience$/u });
		await add.click(); await started;
		await expect(add).toBeDisabled();
		const project = createSoundscaperProject({ id: 'freesound-download-replacement', title: 'Fresh recording', tracks: [], clips: [], sources: [] });
		const archive = await exportScapeProject(project, {
			async getMediaAssetMetadata() { return null; }, async loadMediaAsset() { return null; },
			readSourceChunks() { return (async function* empty() {})(); },
		});
		await page.evaluate(({ bytes, type }) => {
			const body = Uint8Array.from(atob(bytes), character => character.charCodeAt(0));
			globalThis.__freesoundDownloadLaunch({ files: [{ kind: 'file', getFile: () => Promise.resolve(new File([body], 'fresh.sscape', { type })) }] });
		}, { bytes: Buffer.from(await archive.blob.arrayBuffer()).toString('base64'), type: SCAPE_MIME_TYPE });
		await expect(editor).toHaveAttribute('data-project-id', project.id);
		await expect(add).toBeEnabled();
		await add.click();
		await expect(editor).toHaveAttribute('data-clip-count', '1', { timeout: 30_000 });
		release();
		const samples = await exportSamples(page, editor);
		expect(samples.length).toBe(38_400);
		expect(samples.some(value => Math.abs(value) > .1)).toBe(true);
		await expect(editor).toHaveAttribute('data-clip-count', '1');
		await expect(add).toBeEnabled();
	} finally { release(); }
});
