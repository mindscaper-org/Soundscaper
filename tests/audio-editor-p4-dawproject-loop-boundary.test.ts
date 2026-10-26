/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { assertPcmSamplesEqual } from './helpers/assert-pcm-samples.ts';
import { createNativeProjectService } from '../src/common/editor/controller/document/native-project-service.ts';
import { writeDawprojectArchive } from '../src/common/editor/dawproject-archive.ts';
import { encodeWav } from '../src/common/editor/wav.js';
import { importSoundscaperAudacityProject } from '../src/soundscaper/editor-audacity-project-import.ts';
import { validateSoundscaperProject } from '../src/soundscaper/editor-project-validation.ts';
import { createFixture } from './helpers/native-project-service-fixture.ts';

for (const [name, attributes, expectedStart, expectedDuration, converted, contentUnit] of [
	['internal loop boundary', 'duration="2" loopStart="0" loopEnd="1"', 0, 48_000, true, 'seconds'],
	['offset first pass shorter than the loop period', 'duration=".5" playStart=".75" loopStart="0" loopEnd="1"', 36_000, 12_000, true, 'seconds'],
	['one complete pass', 'duration="1" loopStart="0" loopEnd="1"', 0, 48_000, false, 'seconds'],
	['ordinary unlooped content', 'duration="2"', 0, 96_000, false, 'seconds'],
	['loop boundary on the content beat clock', 'duration="2" loopStart="0" loopEnd="2"', 0, 48_000, true, 'beats'],
] as const) test(`File Open DAWproject respects ${name}`, async () => {
	const samples = Float32Array.from({ length: 192_000 }, (_, frame) => frame < 48_000 ? .25 : -.5);
	const audio = new Blob([Uint8Array.from(encodeWav([samples], { sampleRate: 48_000, float: true }))]);
	const archive = await writeDawprojectArchive({ metadataXml: '<MetaData><Title>Loop boundary</Title></MetaData>',
		projectXml: `<Project version="1.0"><Transport><Tempo unit="bpm" value="120"/></Transport><Structure><Track id="voice" name="Voice" contentType="audio"><Channel role="regular"/></Track></Structure>
		<Arrangement><Lanes timeUnit="seconds"><Lanes track="voice"><Clips><Clip time="0" ${attributes} contentTimeUnit="${contentUnit}" name="Take">
		<Audio sampleRate="48000" channels="1" duration="4"><File path="audio/voice.wav"/></Audio></Clip></Clips></Lanes></Lanes></Arrangement></Project>`,
		files: [{ path: 'audio/voice.wav', blob: audio }] });
	const written: number[] = [];
	const fixture = createFixture({ adaptAudacityProject: importSoundscaperAudacityProject,
		store: { estimateStorage: async () => ({ usage: 0, quota: 1e8 }), beginSourceWrite: async () => ({
			write: async channels => { for (const sample of channels[0]!) written.push(sample); },
			commit: async () => undefined, abort: async () => undefined,
		}), deleteSource: async () => undefined },
	});
	const opened = await createNativeProjectService(fixture.runtime).openDawproject(new File([archive], 'Loop boundary.dawproject'));
	assert.ok(opened); assert.ok(validateSoundscaperProject(opened.project));
	const clip = opened.project.clips[0]; assert.ok(clip?.kind === 'audio');
	assert.equal(clip.sourceStartFrame, expectedStart); assert.equal(clip.sourceDurationFrames, expectedDuration);
	assert.equal(clip.durationFrames, expectedDuration); assert.equal(clip.speedRatio, 1);
	assertPcmSamplesEqual(written, [...samples], 'the complete immutable media remains available for later edits');
	const report = opened.report;
	assert.ok(report && typeof report === 'object' && 'items' in report && Array.isArray(report.items));
	assert.equal(report.items.some((item: unknown) => item !== null && typeof item === 'object'
		&& 'code' in item && typeof item.code === 'string' && /loop/iu.test(item.code)), converted);
});
