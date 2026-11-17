/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createNativeProjectService } from '../src/common/editor/controller/document/native-project-service.ts';
import { writeDawprojectArchive } from '../src/common/editor/dawproject-archive.ts';
import { encodeWav } from '../src/common/editor/wav.js';
import { importSoundscaperAudacityProject } from '../src/soundscaper/editor-audacity-project-import.ts';
import { validateSoundscaperProject } from '../src/soundscaper/editor-project-validation.ts';
import { createFixture } from './helpers/native-project-service-fixture.ts';

test('opening a DAWproject folder with its own media keeps the subtree before following tracks', async () => {
	const project = await openFolder();
	assert.deepEqual(project.tracks.map(track => track.name), ['Folder', 'Child', 'Outside']);
	const folder = project.trackFolders[0]!;
	assert.deepEqual(project.sequences[0]!.trackNodes.map(node => [node.kind, node.parentFolderId]), [
		['folder', null], ['track', folder.id], ['track', folder.id], ['track', null],
	]);
	assert.equal(project.clips.length, 1);
	assert.equal(project.tracks[0]!.clipIds[0], project.clips[0]!.id);
});

test('folder devices continue processing all children when the folder has its own media', async () => {
	const project = await openFolder('<Devices><Compressor deviceRole="audioFX"><Threshold value="-18" unit="decibel"/></Compressor></Devices>');
	const bus = project.mixer.groups.find(bus => bus.id === project.trackFolders[0]!.id)!;
	assert.deepEqual(bus.effects.map(effect => effect.type), ['compressor']);
	assert.ok(project.tracks.every(track => !('effects' in track) || !track.effects.length));
});

async function openFolder(devices = '') {
	const projectXml = `<Project><Structure><Track id="folder" name="Folder" contentType="tracks audio"><Channel id="bus" role="submix">${devices}</Channel><Track id="child" name="Child" contentType="audio"/></Track><Track id="outside" name="Outside" contentType="audio"/></Structure><Arrangement><Lanes timeUnit="seconds"><Lanes track="folder"><Clips><Clip time="0" duration="1" contentTimeUnit="seconds"><Audio timeUnit="seconds" duration="1" sampleRate="48000" channels="1"><File path="voice.wav"/></Audio></Clip></Clips></Lanes></Lanes></Arrangement></Project>`;
	const pcm = Uint8Array.from(encodeWav([new Float32Array(48_000).fill(.25)], { sampleRate: 48_000, float: true }));
	const archive = await writeDawprojectArchive({ projectXml, metadataXml: '<MetaData/>', files: [{ path: 'voice.wav', blob: new Blob([pcm]) }] });
	let id = 0;
	const fixture = createFixture({ createStableId: prefix => `${prefix}-${++id}`, adaptAudacityProject: importSoundscaperAudacityProject });
	const result = await createNativeProjectService(fixture.runtime).openDawproject(new File([archive], 'Folder.dawproject'));
	assert.ok(result && validateSoundscaperProject(result.project), 'File Open must publish the imported project');
	return result.project;
}
