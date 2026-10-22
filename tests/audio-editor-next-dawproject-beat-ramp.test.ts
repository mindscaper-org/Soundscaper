/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createNativeProjectService } from '../src/common/editor/controller/document/native-project-service.ts';
import { writeDawprojectArchive } from '../src/common/editor/dawproject-archive.ts';
import { evaluateAutomationLaneAtFrameV21 } from '../src/common/editor/automation-lane-v21.ts';
import { encodeWav } from '../src/common/editor/wav.js';
import { importSoundscaperAudacityProject } from '../src/soundscaper/editor-audacity-project-import.ts';
import { createFixture } from './helpers/native-project-service-fixture.ts';

test('File Open preserves a beat-linear volume ramp across imported tempo changes', async () => {
	const archive = await writeDawprojectArchive({ metadataXml: '<MetaData/>',
		files: [{ path: 'take.wav', blob: new Blob([Uint8Array.from(encodeWav([new Float32Array(96_000).fill(0.25)], { sampleRate: 48_000, float: true }))]) }],
		projectXml: `<Project version="1.0"><Transport><Tempo unit="bpm" value="60" id="tempo"/></Transport>
			<Structure><Track id="track" contentType="audio"><Channel role="regular"><Volume id="volume" unit="linear" value="1"/></Channel></Track></Structure>
			<Arrangement><Lanes timeUnit="beats"><Lanes track="track"><Clips><Clip time="0" duration="2" contentTimeUnit="seconds">
			<Audio timeUnit="seconds"><File path="take.wav"/></Audio></Clip></Clips>
			<Points unit="linear"><Target parameter="volume"/><RealPoint time="0" value="0.2" interpolation="linear"/>
			<RealPoint time="2" value="1"/></Points></Lanes></Lanes>
			<TempoAutomation timeUnit="beats"><Target parameter="tempo"/><RealPoint time="0" value="60" interpolation="hold"/>
			<RealPoint time="1" value="120" interpolation="hold"/></TempoAutomation></Arrangement></Project>`,
	});
	Object.defineProperty(archive, 'name', { value: 'Musical ramp.dawproject' });
	let ordinal = 0;
	const fixture = createFixture({ createStableId: prefix => `${prefix}-${++ordinal}`,
		adaptAudacityProject: importSoundscaperAudacityProject });
	const opened = await createNativeProjectService(fixture.runtime).openDawproject(archive as Blob & { name: string });
	assert.ok(opened);
	assert.equal(opened.project.clips[0]?.durationFrames, 72_000);
	const lane = opened.project.automationLanes[0]; assert.ok(lane);
	assert.ok(Math.abs(evaluateAutomationLaneAtFrameV21(lane, 48_000, { sampleRate: 48_000 }) - 0.6) < 1e-9,
		'the value halfway through two beats must remain0.6at the tempo change, one second into the imported clip');
});
