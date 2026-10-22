/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, registerAudioEditorHooks } from './audio-editor-test-helpers.js';
import { createSoundscaperProject } from '../../src/soundscaper/editor-project.ts';
import { exportScapeProject, SCAPE_MIME_TYPE } from '../../src/common/editor/scape-project.js';

registerAudioEditorHooks();

/** @param {string} id */
async function markerFile(id) {
	const project = createSoundscaperProject({ id, title: id, primarySequenceId: 'main',
		sequences: [{ id: 'main', trackIds: [] }], timelineAnnotations: [{ id: 'marker', sequenceId: 'main',
			name: 'Original', color: 'auto', batchId: null, opaqueExtensions: {}, kind: 'marker', anchor: 'sample', positionFrame: 48_000 }] });
	const result = await exportScapeProject(project, { async getMediaAssetMetadata() { return null; },
		async loadMediaAsset() { return null; }, readSourceChunks() { return (async function* empty() {})(); } });
	expect(result.blob).toBeInstanceOf(Blob);
	return Buffer.from(await result.blob.arrayBuffer()).toString('base64');
}

/** @param {import('@playwright/test').Page} page @param {string} bytes */
async function launch(page, bytes) {
	await page.evaluate(({ content, mimeType }) => {
		const binary = Uint8Array.from(atob(content), character => character.charCodeAt(0));
		globalThis.__moreMarkerLaunch({ files: [{ kind: 'file', getFile: () => Promise.resolve(new File([binary], 'marker.sscape', { type: mimeType })) }] });
	}, { content: bytes, mimeType: SCAPE_MIME_TYPE });
}

for (const surface of ['panel', 'ruler']) test(`a launched native project retires an unfinished ${surface} marker name`, async ({ page }) => {
	await page.addInitScript(() => Object.defineProperty(globalThis, 'launchQueue', {
		configurable: true, value: { setConsumer(consumer) { globalThis.__moreMarkerLaunch = consumer; } },
	}));
	const editor = await bootEditor(page, '/embed/en/');
	await launch(page, await markerFile('marker-origin'));
	await expect(editor).toHaveAttribute('data-project-id', 'marker-origin');
	await chooseCommandAction(page, editor, 'Window', 'Markers');
	const panel = editor.getByRole('region', { name: 'Markers and named regions', exact: true });
	let input = panel.locator('input').first();
	if (surface === 'ruler') {
		await chooseCommandAction(page, editor, 'View', 'Markers');
		const marker = editor.getByRole('listbox', { name: 'Markers and named regions', exact: true }).getByRole('option');
		await marker.focus();
		await marker.press('F2');
		input = editor.locator('.audio-editor-timeline-annotation__rename');
	}
	await input.fill('Origin-only draft');
	await launch(page, await markerFile('marker-replacement'));
	await expect(editor).toHaveAttribute('data-project-id', 'marker-replacement');
	if (surface === 'panel') {
		await expect(input).toHaveValue('Original');
		await input.press('Tab');
	} else await expect(input).toHaveCount(0);
	await expect(panel.locator('[data-annotation-id="marker"]')).toContainText('Original');
});
