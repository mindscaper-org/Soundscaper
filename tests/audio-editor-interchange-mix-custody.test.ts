/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import { validateSoundscaperProject } from '../src/soundscaper/editor-project-validation.ts';
import test from 'node:test';
import type { AudioTrackLeaf } from '../src/common/editor/project-media-types.ts';
import { midiImportArchiveCustody } from './helpers/midi-import-archive-custody.ts';
import { writeDawprojectArchive } from '../src/common/editor/dawproject-archive.ts';
import { encodeWav } from '../src/common/editor/wav.js';
import { evaluateAutomationLaneAtFrameV21 } from '../src/common/editor/automation-lane-v21.ts';
import { soundcraftSession } from './helpers/native-daw-import-fixtures.ts';

test('DAWproject File Open preserves embedded effect bytes, held automation and audio through a portable Scape recipient', async context => {
	const runtime = await midiImportArchiveCustody(context, { audacityProjectAdapter: true, sourcePcmExpectation: () => 'audible' });
	const bytes = Uint8Array.from({ length: 256 }, (_, index) => index);
	const archive = await writeDawprojectArchive({ metadataXml: '<MetaData><Title>Foreign mix</Title></MetaData>',
		projectXml: '<Project version="1.0"><Structure><Track id="voice" name="Voice" contentType="audio"><Channel id="channel"><Volume id="volume" value=".5" unit="linear"/><Devices><ClapPlugin id="echo" deviceID="org.example.echo" deviceName="Echo" deviceRole="audioFX"><Enabled value="false"/><State path="plugins/echo.clap-preset"/></ClapPlugin></Devices></Channel></Track></Structure><Arrangement><Lanes timeUnit="seconds"><Lanes track="voice"><Clips><Clip time="0" duration="1" contentTimeUnit="seconds"><Audio channels="1" sampleRate="48000" duration="1"><File path="audio/voice.wav"/></Audio></Clip></Clips></Lanes><Points unit="linear"><Target parameter="volume"/><RealPoint time="0" value=".2" interpolation="hold"/><RealPoint time="1" value=".8"/></Points></Lanes></Arrangement></Project>',
		files: [{ path: 'plugins/echo.clap-preset', blob: new Blob([bytes]) }, { path: 'audio/voice.wav', blob: new Blob([Uint8Array.from(encodeWav([new Float32Array(48000).fill(.25)], { sampleRate: 48000, float: true }))]) }],
	});
	await runtime.controller.actions.project.openDawproject(new File([archive], 'Foreign.dawproject'));
	const initial = runtime.controller.project;
	assert.ok(validateSoundscaperProject(initial));
	assert.equal((initial.tracks[0] as unknown as AudioTrackLeaf).effects[0]?.type, 'missing');
	assert.equal((initial.tracks[0] as unknown as AudioTrackLeaf).effects[0]?.enabled, false);
	const text = JSON.stringify((initial.tracks[0] as unknown as AudioTrackLeaf).effects[0]);
	assert.ok(text.includes(Buffer.from(bytes).toString('base64')));
	assert.equal(evaluateAutomationLaneAtFrameV21(initial.automationLanes[0]!, 24000, { sampleRate: 48000 }), .2);
	const recipient = await runtime.reopen();
	assert.deepEqual(recipient.project.automationLanes, initial.automationLanes);
	assert.deepEqual(recipient.project.mixer, initial.mixer);
});

test('SoundCraft File Import retains graph sends and control lanes through portable storage', async context => {
	const runtime = await midiImportArchiveCustody(context, { sourcePcmExpectation: () => 'audible' });
	const original = soundcraftSession();
	const session = { ...original, busses: [{ id: 80, name: 'Wet input', format: 'Stereo' }], tracks: original.tracks.map(track => ({ ...track,
		mixer: { ...track.mixer, sends: [{ target: { Bus: 80 }, level_db: -6 }], inserts: [{ plugin: 'echo', state: 'AQID', active: true }] },
		automation: [{ param: { SendLevel: 0 }, enabled: true, points: [{ at: 0, value: -20 }, { at: 48000, value: -6 }] }],
	})) };
	await runtime.controller.actions.project.importFiles([new File([JSON.stringify(session)], 'Foreign.scraft'),
		new File([Uint8Array.from(encodeWav([new Float32Array(48000).fill(.25)], { sampleRate: 48000, float: true }))], 'voice.wav')]);
	const initial = runtime.controller.project;
	assert.ok(validateSoundscaperProject(initial));
	assert.equal(initial.automationLanes[0]?.address.kind, 'edge');
	const recipient = await runtime.reopen();
	assert.deepEqual(recipient.project.automationLanes, initial.automationLanes);
	assert.deepEqual(recipient.project.mixer, initial.mixer);
});
