/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, monoTone, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, chooseFileAction, closeWorkspacePanel,
	disableNativeSavePicker, importFiles } from './audio-editor-test-helpers.js';
import { createSoundscaperProject } from '../../src/soundscaper/editor-project.ts';
import { exportScapeProject, SCAPE_MIME_TYPE } from '../../src/common/editor/scape-project.js';
import { exportSamples } from './helpers/round2-audio-export.js';

test('saving a connection position preserves the audible quiet level from a native file', async ({ page }) => {
	await disableNativeSavePicker(page);
	const base = createSoundscaperProject({ id: 'quiet-native-routing', title: 'Quiet routing' });
	const project = createSoundscaperProject({ ...base, mixer: { ...base.mixer,
		edges: base.mixer.edges.map(edge => ({ ...edge, level: 0.0008 })) } });
	const native = await exportScapeProject(project, { async getMediaAssetMetadata() { return null; },
		async loadMediaAsset() { return null; }, readSourceChunks() { return (async function* empty() {})(); } });
	const editor = await bootEditor(page, '/embed/en/');
	const choosing = page.waitForEvent('filechooser');
	await chooseFileAction(page, editor, 'Open');
	await (await choosing).setFiles({ name: 'quiet.sscape', mimeType: SCAPE_MIME_TYPE, buffer: Buffer.from(await native.blob.arrayBuffer()) });
	await expect(editor).toHaveAttribute('data-project-id', project.id);
	await importFiles(editor, [monoTone]);
	const before = await exportSamples(page, editor);
	const peak = samples => Math.max(...samples.map(Math.abs));
	expect(peak(before)).toBeGreaterThan(0.0001);
	await chooseCommandAction(page, editor, 'Window', 'Mixer');
	const mixer = editor.locator('[data-mixer-panel]');
	await mixer.getByRole('button', { name: 'Routing graph', exact: true }).click();
	const graph = mixer.locator('[data-soundscaper-routing-graph]');
	await graph.locator('[data-routing-edge="assignment:master:output:main"]').click();
	const inspector = graph.locator('[data-routing-inspector="edge"]');
	await inspector.locator('select[name="position"]').selectOption('pre-fader');
	await inspector.getByRole('button', { name: 'Save connection', exact: true }).click();
	await closeWorkspacePanel(editor, 'mixer');
	const after = await exportSamples(page, editor);
	expect(peak(after)).toBeCloseTo(peak(before), 6);
});
