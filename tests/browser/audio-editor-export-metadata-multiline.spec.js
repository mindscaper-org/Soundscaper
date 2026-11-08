/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, disableNativeSavePicker, openExportDialog, readDownloadBytes } from './audio-editor-test-helpers.js';
import { createSoundscaperProject } from '../../src/soundscaper/editor-project.ts';
import { createAudioClip, createAudioSource, createAudioTrack } from '../../src/common/editor/project-media-factory.ts';
import { createProjectStore } from '../../src/common/editor/storage.js';
import { exportScapeProject } from '../../src/common/editor/scape-project.js';
import { inspectWavBlobPcm } from '../../src/common/editor/wav-import.js';

test('export metadata editing retains an imported multiline title', async ({ page }) => {
	const original = 'Opening\nRoom tone';
	const source = createAudioSource({id:'source',storageKey:'source',name:'Room.wav',frameCount:4800,sampleRate:48_000,channelCount:1});
	const project = createSoundscaperProject({id:'multiline-export-metadata',sampleRate:48_000,metadata:{title:original},
		sources:[source],tracks:[createAudioTrack({id:'track',clipIds:['clip']})],
		clips:[createAudioClip({id:'clip',sourceId:source.id,durationFrames:4800,sourceDurationFrames:4800})],
		sequences:[{id:'main',trackIds:['track']}],primarySequenceId:'main'});
	expect(project.metadata.title).toBe(original);
	const store=createProjectStore({indexedDB:null,preferOpfs:false}); let bytes;
	try {
		const writer=await store.beginSourceWrite(source.storageKey,{name:source.name,mimeType:source.mimeType,sampleRate:source.sampleRate,channelCount:source.channelCount,chunkFrames:source.chunkFrames});
		await writer.write([new Float32Array(source.frameCount).fill(.2)]); await writer.commit();
		bytes=Buffer.from(await(await exportScapeProject(project,store)).blob.arrayBuffer());
	} finally {await store.close();}
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/embed/en/');
	await editor.locator('[data-aup4-input]').setInputFiles({name:'Multiline.sscape',mimeType:'application/zip',buffer:bytes});
	await expect(editor).toHaveAttribute('data-project-id',project.id);
	await expect(editor).toHaveAttribute('data-clip-count','1');
	let dialog = await openExportDialog(page, editor);
	await dialog.getByRole('button',{name:'Metadata',exact:true}).click();
	const metadata = page.getByRole('dialog',{name:'Metadata',exact:true});
	const title = metadata.getByRole('textbox',{name:'Title',exact:true});
	await title.focus(); await title.press('Control+End'); await title.pressSequentially('!'); await title.press('Tab');
	await metadata.getByRole('button',{name:'Done',exact:true}).click();
	dialog = editor.locator('[data-export-dialog]');
	await dialog.getByRole('button',{name:'Export',exact:true}).click();
	const link = dialog.locator('[data-export-download]');
	await expect(link).toBeVisible();
	const exported = await inspectWavBlobPcm(new Blob([await readDownloadBytes(page,link)]));
	expect(exported.info.title).toBe(`${original}!`);
});
