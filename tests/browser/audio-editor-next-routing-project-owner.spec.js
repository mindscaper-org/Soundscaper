/* SPDX-License-Identifier: AGPL-3.0-only */
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseNestedCommandAction, waitForProjectActivation } from './audio-editor-test-helpers.js';
import { createSoundscaperProject } from '../../src/soundscaper/editor-project.ts';
import { exportScapeProject, SCAPE_MIME_TYPE } from '../../src/common/editor/scape-project.js';
import { addSoundscaperRoutingItem } from '../../src/common/editor/ui/workspace/soundscaper-routing-graph-candidates.ts';

/** @param {string} id */
async function projectFile(id) {
	const base = createSoundscaperProject({ id, title: id });
	const project = createSoundscaperProject({ ...base, mixer: addSoundscaperRoutingItem(base, base.mixer, 'cue').graph });
	const exported = await exportScapeProject(project, { async getMediaAssetMetadata() { return null; },
		async loadMediaAsset() { return null; }, readSourceChunks() { return (async function* empty() {})(); } });
	expect(exported.blob).toBeInstanceOf(Blob);
	return Buffer.from(await exported.blob.arrayBuffer()).toString('base64');
}
/** @param {import('@playwright/test').Page} page @param {string} content */
async function launch(page, content) {
	await page.evaluate(({ content, mimeType }) => {
		const bytes = Uint8Array.from(atob(content), character => character.charCodeAt(0));
		globalThis.__nextRoutingLaunch({ files: [{ kind: 'file', getFile: () => Promise.resolve(new File([bytes], 'routing.sscape', { type: mimeType })) }] });
	}, { content, mimeType: SCAPE_MIME_TYPE });
}

test('NP020: an OS project activation retires the outgoing routing delete confirmation', async ({ page }) => {
	await page.addInitScript(() => Object.defineProperty(globalThis, 'launchQueue', {
		configurable: true, value: { setConsumer(consumer) { globalThis.__nextRoutingLaunch = consumer; } },
	}));
	const editor = await bootEditor(page, '/en/');
	await launch(page, await projectFile('routing-outgoing'));
	await expect(editor).toHaveAttribute('data-project-id', 'routing-outgoing'); await waitForProjectActivation(editor);
	await chooseNestedCommandAction(page, editor, 'Window', ['Mixer']);
	const mixer = editor.locator('[data-mixer-panel]');
	await mixer.getByRole('button', { name: 'Routing graph', exact: true }).click();
	const graph = mixer.locator('[data-soundscaper-routing-graph]');
	const cue = graph.locator('[data-routing-node^="mixer-node:cue"]').first();
	await cue.locator('.kw-routing-graph__node-main').press('Delete');
	const confirm = graph.getByRole('button', { name: 'Confirm delete', exact: true });
	await expect(confirm).toBeVisible();
	await launch(page, await projectFile('routing-incoming'));
	await expect(editor).toHaveAttribute('data-project-id', 'routing-incoming'); await waitForProjectActivation(editor);
	await expect(confirm).toHaveCount(0);
	await expect(cue).toBeVisible();
});
