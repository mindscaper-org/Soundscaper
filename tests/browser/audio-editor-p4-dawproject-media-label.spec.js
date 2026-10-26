/* SPDX-License-Identifier: AGPL-3.0-only */
import { expect, test } from './audio-editor-test-fixtures.js';
import { strFromU8, unzipSync } from 'fflate';
import { bootEditor, chooseFileAction, chooseNestedCommandAction, chooseExportProjectFileAction, disableNativeSavePicker, downloadBytes, waitForProjectActivation } from './audio-editor-test-helpers.js';
import { writeDawprojectArchive } from '../../src/common/editor/dawproject-archive.ts';
import { parseScapeProjectDocument } from '../../src/common/editor/scape-project-document.ts';
import { encodeWav } from '../../src/common/editor/wav.js';
import { parseXmlDocument, DAWPROJECT_XML_LIMITS, walkXml } from '../../src/common/editor/dawproject-xml.ts';

for (const named of [true, false]) test(`DAWproject File Open preserves ${named ? 'the authored Audio media label' : 'the ordinary filename fallback'}`, async ({ page }) => {
	test.setTimeout(60_000);
	const expected = named ? 'Room microphone' : 'encoded.wav';
	const audio = new Blob([encodeWav([new Float32Array(4800).fill(.25)], { sampleRate: 48_000, float: true })]);
	const archive = await writeDawprojectArchive({ metadataXml: '<MetaData><Title>Media labels</Title></MetaData>',
		projectXml: `<Project version="1.0"><Application name="Media labels" version="1"/><Structure><Track id="voice" name="Voice" contentType="audio"><Channel role="regular"/></Track></Structure><Arrangement><Lanes timeUnit="seconds"><Lanes track="voice"><Clips><Clip time="0" duration=".1"><Audio ${named ? 'name="Room microphone"' : ''} channels="1" sampleRate="48000" duration=".1" timeUnit="seconds"><File path="audio/encoded.wav"/></Audio></Clip></Clips></Lanes></Lanes></Arrangement></Project>`,
		files: [{ path: 'audio/encoded.wav', blob: audio }] });
	await disableNativeSavePicker(page); const editor = await bootEditor(page, '/embed/en/', { defaultWorkspace: true });
	const choosing = page.waitForEvent('filechooser'); await chooseFileAction(page, editor, 'Open');
	await (await choosing).setFiles({ name: 'Media labels.dawproject', mimeType: 'application/zip', buffer: Buffer.from(await archive.arrayBuffer()) });
	await expect(editor.locator('[data-status]')).toHaveText('DAWproject imported.', { timeout: 30_000 });
	await waitForProjectActivation(editor); await expect(editor).toHaveAttribute('data-clip-count', '1');
	const saving = page.waitForEvent('download'); await chooseExportProjectFileAction(page, editor);
	const download = await saving; let bytes;
	try { bytes = await downloadBytes(download); } finally { await download.delete(); }
	const saved = parseScapeProjectDocument(strFromU8(unzipSync(bytes)['project.json']), { currentProjectSchemaFamily: 'soundscaper' });
	expect(saved.sources[0].name).toBe(expected); expect(saved.clips[0].title).toBe(expected);
	expect(saved.sources[0].frameCount).toBe(4800); expect(saved.clips[0].durationFrames).toBe(4800);
	await expect(editor.locator('[data-clip-id]').first().locator('.clip-header__name')).toHaveText(expected);
	const exporting = page.waitForEvent('download'); await chooseNestedCommandAction(page, editor, 'File', ['Export other', 'Export DAWproject']);
	const delivered = await exporting; let exported;
	try { exported = await downloadBytes(delivered); } finally { await delivered.delete(); }
	const xml = parseXmlDocument(strFromU8(unzipSync(exported)['project.xml']), DAWPROJECT_XML_LIMITS);
	const media = [...walkXml(xml)].find(element => element.name === 'Audio'); expect(media.attributes.name).toBe(expected);
	const path = media.children.find(element => element.name === 'File').attributes.path;
	expect(path).toBe('audio/001-' + (named ? 'Room-microphone' : 'encoded') + '.wav');
	const previousId = await editor.getAttribute('data-project-id');
	const reopening = page.waitForEvent('filechooser'); await chooseFileAction(page, editor, 'Open');
	await (await reopening).setFiles({ name: 'Round trip.dawproject', mimeType: 'application/zip', buffer: Buffer.from(exported) });
	await expect(editor).not.toHaveAttribute('data-project-id', previousId); await waitForProjectActivation(editor);
	await expect(editor.locator('[data-clip-id]').first().locator('.clip-header__name')).toHaveText(expected);
	const savingAgain = page.waitForEvent('download'); await chooseExportProjectFileAction(page, editor);
	const second = await savingAgain; let restoredBytes;
	try { restoredBytes = await downloadBytes(second); } finally { await second.delete(); }
	const restored = parseScapeProjectDocument(strFromU8(unzipSync(restoredBytes)['project.json']), { currentProjectSchemaFamily: 'soundscaper' });
	expect(restored.sources[0].name).toBe(expected); expect(restored.sources[0].contentSha256).toBe(saved.sources[0].contentSha256);
});
