/* SPDX-License-Identifier: AGPL-3.0-only */
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, importFiles } from './audio-editor-test-helpers.js';
for(const explicit of[false,true])test(`absolute GRO track index preserves lane inventory explicit=${explicit}`,async({page})=>{
	const editor=await bootEditor(page,'/embed/en/');
	const text=(explicit?'#track 0\n#track 1\n':'')+'#track 2 Lead\nT0 V0 P60 U0.125 L100\n';
	await importFiles(editor,[{name:'Three tracks.gro',mimeType:'text/plain',buffer:Buffer.from(text)}]);
	await expect(editor).toHaveAttribute('data-clip-count','3');
	await expect(editor).toHaveAttribute('data-track-count','4');
});
