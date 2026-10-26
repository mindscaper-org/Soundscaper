/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { writeDawprojectArchive } from '../src/common/editor/dawproject-archive.ts';
import { encodeWav } from '../src/common/editor/wav.js';
import { importSoundscaperAudacityProject } from '../src/soundscaper/editor-audacity-project-import.ts';
import { validateSoundscaperProject } from '../src/soundscaper/editor-project-validation.ts';
import { createSoundscaperProjectRuntimeSelection } from '../src/soundscaper/editor-project-runtime-selection.ts';
import { COPY, createAudioEditorController, createMemoryEngine, createProjectStore } from './helpers/audio-editor-controller-harness.js';
import { createMemoryFfmpeg } from './helpers/audio-editor-controller-fixtures.js';
type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;

for (const kind of ['track', 'folder', 'group', 'clip'] as const) for (const name of ['   ', kind === 'folder' ? 'Voice' : ' Voice ']) test(`P020 ancillary: DAWproject ${kind} display name ${JSON.stringify(name)} retains a usable session`, async context => {
	const leaf = `<Track id="voice" name="${kind === 'track' ? name : 'Voice'}" contentType="audio"><Channel role="regular" audioChannels="2"${kind === 'group' ? ' destination="bus"' : ''}/></Track>`;
	const structure = kind === 'folder' ? `<Track id="folder" name="${name}" contentType="tracks"><Channel role="submix" audioChannels="2"/>${leaf}</Track>`
		: leaf + (kind === 'group' ? `<Track id="group" name="${name}" contentType="audio"><Channel id="bus" role="submix" audioChannels="2"/></Track>` : '');
	const xml = `<Project version="1.0"><Application name="Blank names" version="1"/><Structure>${structure}</Structure><Arrangement><Lanes timeUnit="seconds"><Lanes track="voice"><Clips><Clip time="0" duration=".1" name="${kind === 'clip' ? name : 'Voice'}"><Audio channels="2" sampleRate="48000" duration=".1"><File path="voice.wav"/></Audio></Clip></Clips></Lanes></Lanes></Arrangement></Project>`;
	const pcm = new Float32Array(4800).fill(.25); const archive = await writeDawprojectArchive({ projectXml: xml, metadataXml: '<MetaData/>', files: [{ path: 'voice.wav', blob: new Blob([Uint8Array.from(encodeWav([pcm, pcm], { sampleRate: 48_000, float: true }))]) }] });
	const runtime = createSoundscaperProjectRuntimeSelection();
	const controller = createAudioEditorController(null, { headless: true, productId: 'soundscaper', locale: 'en', copy: COPY,
		store: createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: context.name }), projectRuntime: runtime, sessionController: runtime.createSessionController(), adaptAudacityProject: importSoundscaperAudacityProject,
		engine: createMemoryEngine() as unknown as Options['engine'], ffmpeg: createMemoryFfmpeg() as unknown as Options['ffmpeg'] });
	context.after(async () => { await controller.dispose(); }); await controller.ready;
	await controller.actions.project.openDawproject(new File([archive], 'Blank names.dawproject'));
	const project: unknown = controller.project; assert.ok(validateSoundscaperProject(project)); assert.equal(project.clips.length, 1);
	const owner = kind === 'folder' ? project.trackFolders[0] : kind === 'group' ? project.mixer.groups[0]
		: kind === 'clip' ? project.clips[0] : project.tracks.find(track => track.type === 'audio');
	assert.ok(owner); const actual = 'title' in owner ? owner.title : owner.name;
	if (kind === 'group') assert.equal(actual, name.trim() || 'Group 1');
	else if (name.trim()) assert.equal(actual, name); else assert.ok(typeof actual === 'string' && actual.trim());
});
