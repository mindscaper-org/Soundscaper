/* SPDX-License-Identifier: AGPL-3.0-only */
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseFileAction, chooseNestedCommandAction, disableNativeSavePicker, downloadBytes, waitForProjectActivation } from './audio-editor-test-helpers.js';
import { exportSamples } from './helpers/round2-audio-export.js';
import { createProjectStore } from '../../src/common/editor/storage.js';
import { exportScapeProject } from '../../src/common/editor/scape-project.js';
import { dawprojectForeignRoute } from '../helpers/dawproject-foreign-route.ts';
import { readDawprojectArchive } from '../../src/common/editor/dawproject-archive.ts';
import { parseXmlDocument, walkXml } from '../../src/common/editor/dawproject-xml.ts';

test('DAWproject export retains an automated foreign folder chain in the audible primary route', async ({ page }) => {
	const route = 'foreign-chain', automated = true;
	test.setTimeout(90_000);
	const { project, source, pcm } = dawprojectForeignRoute(route, automated);
	const store = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: crypto.randomUUID() }); let archive;
	try {
		const writer = await store.beginSourceWrite(source.storageKey, source); await writer.write(pcm); await writer.commit();
		archive = (await exportScapeProject(project, store)).blob;
	} finally { await store.close(); }
	await disableNativeSavePicker(page); const editor = await bootEditor(page, '/embed/en/', { defaultWorkspace: true });
	let choosing = page.waitForEvent('filechooser'); await chooseFileAction(page, editor, 'Open');
	await (await choosing).setFiles({ name: 'Cross-sequence bus.sscape', mimeType: 'application/zip', buffer: Buffer.from(await archive.arrayBuffer()) });
	await expect(editor).toHaveAttribute('data-project-id', project.id); await waitForProjectActivation(editor);
	const before = await exportSamples(page, editor); expect(before).toHaveLength(4800); expect(before[2000]).toBeCloseTo((automated ? .05 : .1) * (route === 'foreign-chain' ? .4 : 1), 5);
	const downloading = page.waitForEvent('download'); await chooseNestedCommandAction(page, editor, 'File', ['Export other', 'Export DAWproject']);
	const download = await downloading; let bytes;
	try { bytes = await downloadBytes(download); } finally { await download.delete(); }
	const delivered = await readDawprojectArchive(new Blob([bytes]));
	try {
		const nodes = [...walkXml(parseXmlDocument(delivered.projectXml))]; const ids = new Set(nodes.map(node => node.attributes.id).filter(Boolean));
		expect.soft(nodes.flatMap(node => node.attributes.destination && !ids.has(node.attributes.destination) ? [node.attributes.destination] : [])).toEqual([]);
		expect(nodes.some(node => node.name === 'Track' && node.attributes.name === 'Other sequence recording')).toBe(false);
	} finally { await delivered.close(); }
	choosing = page.waitForEvent('filechooser'); await chooseFileAction(page, editor, 'Open');
	await (await choosing).setFiles({ name: 'Cross-sequence bus.dawproject', mimeType: 'application/zip', buffer: Buffer.from(bytes) });
	await expect(editor.locator('[data-status]')).toContainText('DAWproject imported.', { timeout: 30_000 }); await waitForProjectActivation(editor);
	const after = await exportSamples(page, editor); expect(after).toHaveLength(before.length); expect(after[2000]).toBeCloseTo(before[2000], 5);
});
