/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createNativeProjectService } from '../src/common/editor/controller/document/native-project-service.ts';
import { writeDawprojectArchive } from '../src/common/editor/dawproject-archive.ts';
import { encodeWav } from '../src/common/editor/wav.js';
import { importSoundscaperAudacityProject } from '../src/soundscaper/editor-audacity-project-import.ts';
import { validateSoundscaperProject } from '../src/soundscaper/editor-project-validation.ts';
import { envelopeValueAtFrame } from '../src/common/editor/automation.js';
import { createFixture } from './helpers/native-project-service-fixture.ts';

for (const [name, attributes, expectedStart, expectedDuration, stop, contentUnit, nested] of [
 ['explicit parent duration', 'duration="2" playStop="1"', 0, 96_000, 48_000, 'seconds'],
 ['offset content origin', 'duration="2" playStart=".5" playStop="1"', 24_000, 96_000, 24_000, 'seconds'],
 ['content beat clock', 'duration="2" playStop="2"', 0, 96_000, 48_000, 'beats'],
 ['inferred duration', 'playStop="1"', 0, 48_000, 48_000, 'seconds'],
 ['coincident duration', 'duration="1" playStop="1"', 0, 48_000, 48_000, 'seconds'],
 ['ordinary content', 'duration="2"', 0, 96_000, 96_000, 'seconds'],
 ['nested parent stop', 'duration="2" playStop="1"', 0, 96_000, 48_000, 'seconds', true],
 ['nested fade layers', 'duration="2" playStop="1" fadeInTime=".5"', 0, 96_000, 48_000, 'seconds', true],
 ['stop at content origin', 'duration="2" playStop="0"', 0, 96_000, 0, 'seconds'],
] as const) test(`File Open DAWproject respects ${name}`, async () => {
	const samples = Float32Array.from({ length: 192_000 }, (_, frame) => frame < 48_000 ? .25 : -.5);
	const audio = new Blob([Uint8Array.from(encodeWav([samples], { sampleRate: 48_000, float: true }))]);
	const archive = await writeDawprojectArchive({ metadataXml: '<MetaData><Title>Content stop</Title></MetaData>',
		projectXml: `<Project version="1.0"><Application name="Soundscaper regression" version="1"/><Transport><Tempo unit="bpm" value="120"/></Transport><Structure><Track id="voice" name="Voice" contentType="audio"><Channel role="regular"/></Track></Structure>
		<Arrangement><Lanes timeUnit="seconds"><Lanes track="voice"><Clips><Clip time="0" ${attributes} contentTimeUnit="${contentUnit}" name="Take">
		${nested ? '<Clips><Clip time="0" duration="2" playStop="1.5" contentTimeUnit="seconds" fadeInTime=".25">' : ''}
		<Audio sampleRate="48000" channels="1" duration="4"><File path="audio/voice.wav"/></Audio>${nested ? '</Clip></Clips>' : ''}</Clip></Clips></Lanes></Lanes></Arrangement></Project>`,
		files: [{ path: 'audio/voice.wav', blob: audio }] });
	const written: number[] = [];
	const fixture = createFixture({ adaptAudacityProject: importSoundscaperAudacityProject,
		store: { estimateStorage: async () => ({ usage: 0, quota: 1e8 }), beginSourceWrite: async () => ({
			write: async channels => { for (const sample of channels[0]!) written.push(sample); },
			commit: async () => undefined, abort: async () => undefined,
		}), deleteSource: async () => undefined },
	});
	const opened = await createNativeProjectService(fixture.runtime).openDawproject(new File([archive], 'Content stop.dawproject'));
	assert.ok(opened); assert.ok(validateSoundscaperProject(opened.project));
	const clip = opened.project.clips[0]; assert.ok(clip?.kind === 'audio');
	assert.equal(clip.sourceStartFrame, expectedStart); assert.equal(clip.sourceDurationFrames, expectedDuration);
	assert.equal(clip.durationFrames, expectedDuration); assert.equal(clip.speedRatio, 1);
	assert.deepEqual(written, [...samples], 'the complete immutable media remains available for later edits');
	assert.equal(envelopeValueAtFrame(clip.envelope, Math.max(0, stop - 1), expectedDuration), stop > 0 ? 1 : 0);
	if (stop < expectedDuration) assert.equal(envelopeValueAtFrame(clip.envelope, stop, expectedDuration), 0);
	const report = opened.report;
	assert.ok(report && typeof report === 'object' && 'items' in report && Array.isArray(report.items));
	assert.equal(report.items.some((item: unknown) => item !== null && typeof item === 'object'
		&& 'code' in item && typeof item.code === 'string' && /loop/iu.test(item.code)), false);
});
