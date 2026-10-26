/* SPDX-License-Identifier: AGPL-3.0-only */
import { strFromU8, unzipSync } from 'fflate';
import { expect, test, createWavFixture } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseFileAction, chooseNestedCommandAction, chooseExportProjectFileAction, disableNativeSavePicker, downloadBytes, waitForProjectActivation, sourcePeakChannels } from './audio-editor-test-helpers.js';
import { writeDawprojectArchive } from '../../src/common/editor/dawproject-archive.ts';
import { parseScapeProjectDocument } from '../../src/common/editor/scape-project-document.ts';
import { parseXmlDocument, DAWPROJECT_XML_LIMITS, childElement } from '../../src/common/editor/dawproject-xml.ts';

const credits = { originalArtist: 'Original performer', composer: 'Composer & co.', songwriter: 'Song writer',
	producer: 'Producer', arranger: 'Arranger', genre: 'Genre', copyright: '© Reviewed owner', website: 'https://example.test/credits' };
const fields = ['OriginalArtist', 'Composer', 'Songwriter', 'Producer', 'Arranger', 'Genre', 'Copyright', 'Website'];

for (const additional of [true, false]) test(`DAWproject File Open and native Save retain ${additional ? 'all standard credits' : 'ordinary primary metadata'}`, async ({ page }) => {
	test.setTimeout(90_000);
	const wav = createWavFixture({ name: 'voice.wav', frequency: 440, duration: .1, sampleRate: 48_000, channelCount: 1 });
	const metadataXml = '<MetaData><Title>Credits</Title><Artist>Performer</Artist><Album>Album</Album>'
		+ (additional ? fields.slice(0, 5).map((field, index) => `<${field}><![CDATA[${Object.values(credits)[index]}]]></${field}>`).join('') : '')
		+ '<Year>2026</Year>' + (additional ? fields.slice(5).map((field, index) => `<${field}><![CDATA[${Object.values(credits)[index + 5]}]]></${field}>`).join('') : '')
		+ '<Comment>Session notes</Comment></MetaData>';
	const archive = await writeDawprojectArchive({ metadataXml, projectXml: `<Project version="1.0"><Application name="Credits" version="1"/>
		<Structure><Track id="voice" name="Voice" contentType="audio"><Channel role="regular"/></Track></Structure>
		<Arrangement><Lanes timeUnit="seconds"><Lanes track="voice"><Clips><Clip time="0" duration=".1" contentTimeUnit="seconds">
		<Audio channels="1" sampleRate="48000" duration=".1"><File path="audio/voice.wav"/></Audio>
		</Clip></Clips></Lanes></Lanes></Arrangement></Project>`, files: [{ path: 'audio/voice.wav', blob: new Blob([wav.buffer]) }] });
	await disableNativeSavePicker(page); const editor = await bootEditor(page, '/embed/en/', { defaultWorkspace: true });
	const choosing = page.waitForEvent('filechooser'); await chooseFileAction(page, editor, 'Open');
	await (await choosing).setFiles({ name: 'Credits.dawproject', mimeType: 'application/zip', buffer: Buffer.from(await archive.arrayBuffer()) });
	await expect(editor.locator('[data-status]')).toContainText('DAWproject imported.', { timeout: 30_000 }); await waitForProjectActivation(editor);
	await expect(editor).toHaveAttribute('data-clip-count', '1');
	const peaks = await sourcePeakChannels(page, 'voice.wav'); expect(peaks.channels[0].maximum).toBeGreaterThan(.19);
	const saving = page.waitForEvent('download'); await chooseExportProjectFileAction(page, editor);
	const download = await saving; let native;
	try { native = unzipSync(await downloadBytes(download)); } finally { await download.delete(); }
	const project = parseScapeProjectDocument(strFromU8(native['project.json']), { currentProjectSchemaFamily: 'soundscaper' });
	expect(project.metadata.artist).toBe('Performer'); expect(project.metadata.comments).toBe('Session notes');
	expect(project.metadata.tags).toEqual(additional ? credits : {});
	if (additional) {
		await chooseNestedCommandAction(page, editor, 'File', ['Project management', 'Project properties']);
		const panel = editor.locator('[data-workspace-panel="metadata"]'); await panel.getByRole('tab', { name: 'ID3', exact: true }).click();
		const composer = panel.getByRole('textbox', { name: 'Composer', exact: true }); await expect(composer).toHaveValue(credits.composer);
		await composer.fill('Edited composer'); await composer.press('Tab');
	}
	const exporting = page.waitForEvent('download'); await chooseNestedCommandAction(page, editor, 'File', ['Export other', 'Export DAWproject']);
	const delivered = await exporting; let files;
	try { files = unzipSync(await downloadBytes(delivered)); } finally { await delivered.delete(); }
	const metadata = parseXmlDocument(strFromU8(files['metadata.xml']), DAWPROJECT_XML_LIMITS);
	expect(childElement(metadata, 'Artist').text).toBe('Performer');
	expect(fields.map(field => childElement(metadata, field)?.text)).toEqual(additional
		? Object.values({ ...credits, composer: 'Edited composer' }) : fields.map(() => undefined));
	await expect(editor).toHaveAttribute('data-clip-count', '1');
});
