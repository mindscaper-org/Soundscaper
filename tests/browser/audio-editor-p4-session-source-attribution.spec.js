/* SPDX-License-Identifier: AGPL-3.0-only */
import { strFromU8, unzipSync } from 'fflate';
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseFileAction, chooseCommandAction, chooseExportProjectFileAction, disableNativeSavePicker,
	downloadBytes, importFiles, sourcePeakChannels, waitForProjectActivation } from './audio-editor-test-helpers.js';
import { encodeWav } from '../../src/common/editor/wav.js';
import { writeDawprojectArchive } from '../../src/common/editor/dawproject-archive.ts';
import { parseScapeProjectDocument } from '../../src/common/editor/scape-project-document.ts';

for (const session of [true, false]) test(`${session ? 'DAWproject File Open' : 'ordinary File Import control'} retains source credit in Attribution and native Save`, async ({ page }) => {
	test.setTimeout(90_000);
	const audio = new Blob([encodeWav([new Float32Array(4800).fill(.25)], { sampleRate: 48_000, float: true,
		metadata: { title: 'Field take', artist: 'Source performer' } })]);
	await disableNativeSavePicker(page); const editor = await bootEditor(page, '/embed/en/', { defaultWorkspace: true });
	if (session) {
		const archive = await writeDawprojectArchive({ metadataXml: '<MetaData><Title>Session</Title><Artist>Session performer</Artist></MetaData>',
			projectXml: '<Project version="1.0"><Application name="Credits" version="1"/><Structure><Track id="voice" name="Voice" contentType="audio"><Channel role="regular"/></Track></Structure>'
				+ '<Arrangement><Lanes timeUnit="seconds"><Lanes track="voice"><Clips><Clip time="0" duration=".1" contentTimeUnit="seconds"><Audio channels="1" sampleRate="48000" duration=".1"><File path="audio/voice.wav"/></Audio></Clip></Clips></Lanes></Lanes></Arrangement></Project>',
			files: [{ path: 'audio/voice.wav', blob: audio }] });
		const choosing = page.waitForEvent('filechooser'); await chooseFileAction(page, editor, 'Open');
		await (await choosing).setFiles({ name: 'Session.dawproject', mimeType: 'application/zip', buffer: Buffer.from(await archive.arrayBuffer()) });
		await expect(editor.locator('[data-status]')).toContainText('DAWproject imported.', { timeout: 30_000 }); await waitForProjectActivation(editor);
	} else await importFiles(editor, [{ name: 'voice.wav', mimeType: 'audio/wav', buffer: Buffer.from(await audio.arrayBuffer()) }]);
	await expect(editor).toHaveAttribute('data-clip-count', '1');
	const peak = await sourcePeakChannels(page, 'voice.wav'); expect(peak.channels[0].maximum).toBeGreaterThan(.24);
	const downloading = page.waitForEvent('download'); await chooseExportProjectFileAction(page, editor);
	const download = await downloading; let project;
	try { project = parseScapeProjectDocument(strFromU8(unzipSync(await downloadBytes(download))['project.json']), { currentProjectSchemaFamily: 'soundscaper' }); }
	finally { await download.delete(); }
	await chooseCommandAction(page, editor, 'Edit', 'Metadata editor');
	const panel = editor.locator('[data-workspace-panel="metadata"]'); await panel.getByRole('tab', { name: 'Attribution', exact: true }).click();
	const report = panel.getByRole('tabpanel', { name: 'Attribution', exact: true });
	await report.getByText('Imported metadata', { exact: true }).click();
	await expect(report.getByText('Source performer', { exact: true }).first()).toBeVisible();
	expect(project.sources[0].provenance).toMatchObject({ classification: 'imported', contributions: [{
		origin: { kind: 'local-file', originalFileName: 'voice.wav', mimeType: 'audio/wav', byteLength: audio.size },
		metadata: { normalized: { artist: 'Source performer', title: 'Field take' } },
	}] });
});
