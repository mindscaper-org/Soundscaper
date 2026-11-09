/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseFileAction, chooseNestedCommandAction, disableNativeSavePicker, downloadBytes, waitForProjectActivation } from './audio-editor-test-helpers.js';
import { exportSamples } from './helpers/round2-audio-export.js';
import { createProjectStore } from '../../src/common/editor/storage.js';
import { exportScapeProject } from '../../src/common/editor/scape-project.js';
import { dawprojectMasterRoute } from '../helpers/dawproject-master-route.ts';

for (const route of ['automated coexisting paths', 'absent Master output']) test(`DAWproject roundtrip retains ${route}`, async ({ page }) => {
	test.setTimeout(90_000);
	const { project, source, pcm } = dawprojectMasterRoute(route);
	const store = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: crypto.randomUUID() }); let archive;
	try {
		const writer = await store.beginSourceWrite(source.storageKey, source);
		await writer.write(pcm); await writer.commit();
		archive = (await exportScapeProject(project, store)).blob;
	} finally { await store.close(); }
	await disableNativeSavePicker(page); const editor = await bootEditor(page, '/embed/en/', { defaultWorkspace: true });
	let choosing = page.waitForEvent('filechooser'); await chooseFileAction(page, editor, 'Open');
	await (await choosing).setFiles({ name: 'Master bypass.sscape', mimeType: 'application/zip', buffer: Buffer.from(await archive.arrayBuffer()) });
	await expect(editor).toHaveAttribute('data-project-id', project.id); await waitForProjectActivation(editor);
	const before = await exportSamples(page, editor); expect(before).toHaveLength(4800);
	expect(before[2000]).toBeCloseTo(route.includes('secondary output') ? 0 : route === 'absent Master output' || route === 'disabled Master output' ? .1 : route.includes('coexisting') ? route.startsWith('automated') ? .29 : .27 : route === 'ordinary Master processing' ? .05 : .25, 5);
	const downloading = page.waitForEvent('download');
	await chooseNestedCommandAction(page, editor, 'File', ['Export other', 'Export DAWproject']);
	const download = await downloading; let bytes;
	try { bytes = await downloadBytes(download); } finally { await download.delete(); }
	choosing = page.waitForEvent('filechooser'); await chooseFileAction(page, editor, 'Open');
	await (await choosing).setFiles({ name: 'Master bypass.dawproject', mimeType: 'application/zip', buffer: Buffer.from(bytes) });
	await expect(editor.locator('[data-status]')).toContainText('DAWproject imported.', { timeout: 30_000 }); await waitForProjectActivation(editor);
	const after = await exportSamples(page, editor); expect(after).toHaveLength(before.length);
	expect(after[2000]).toBeCloseTo(before[2000], 5);
});
