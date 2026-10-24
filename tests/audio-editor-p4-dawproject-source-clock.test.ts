/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createNativeProjectService } from '../src/common/editor/controller/document/native-project-service.ts';
import { writeDawprojectArchive } from '../src/common/editor/dawproject-archive.ts';
import { encodeWav } from '../src/common/editor/wav.js';
import { importSoundscaperAudacityProject } from '../src/soundscaper/editor-audacity-project-import.ts';
import { validateSoundscaperProject } from '../src/soundscaper/editor-project-validation.ts';
import { createFixture } from './helpers/native-project-service-fixture.ts';

for (const sourceRate of [3_000, 44_100, 48_000]) {
	test(`File Open DAWproject keeps ${String(sourceRate)} Hz source PCM in an admitted programme clock`, async () => {
		const channel = Float32Array.from({ length: sourceRate }, (_, frame) => (frame % 17 - 8) / 16);
		const audio = new Blob([encodeWav([channel], { sampleRate: sourceRate, float: true }) as Uint8Array<ArrayBuffer>]);
		const archive = await writeDawprojectArchive({ metadataXml: '<MetaData><Title>Source clock</Title></MetaData>',
			projectXml: `<Project version="1.0"><Transport><Tempo unit="bpm" value="120"/></Transport>
			<Structure><Track id="track" name="Voice" contentType="audio"><Channel role="regular"/></Track></Structure>
			<Arrangement><Lanes timeUnit="seconds"><Lanes track="track"><Clips><Clip time="0.5" duration="1" contentTimeUnit="seconds">
			<Audio sampleRate="${String(sourceRate)}" channels="1" duration="1"><File path="audio/voice.wav"/></Audio>
			</Clip></Clips></Lanes></Lanes></Arrangement></Project>`, files: [{ path: 'audio/voice.wav', blob: audio }] });
		const written: number[] = [];
		const fixture = createFixture({ adaptAudacityProject: importSoundscaperAudacityProject,
			store: { estimateStorage: async () => ({ usage: 0, quota: 1_000_000 }), beginSourceWrite: async (_id, metadata) => {
				assert.equal(metadata.sampleRate, sourceRate);
				return { write: async channels => { written.push(...channels[0]!); }, commit: async () => undefined, abort: async () => undefined };
			}, deleteSource: async () => undefined },
		});
		const opened = await createNativeProjectService(fixture.runtime).openDawproject(new File([archive], 'Source clock.dawproject'));
		assert.ok(opened);
		assert.ok(validateSoundscaperProject(opened.project));
		const programmeRate = sourceRate < 8_000 ? 48_000 : sourceRate;
		assert.equal(opened.project.sampleRate, programmeRate);
		assert.deepEqual(written, [...channel]);
		const source = opened.project.sources[0]; assert.ok(source);
		assert.equal(source.kind, 'audio');
		assert.ok(source.kind === 'audio');
		assert.equal(source.sampleRate, sourceRate);
		assert.equal(source.frameCount, sourceRate);
		const clip = opened.project.clips[0]; assert.ok(clip);
		assert.ok(clip.kind === 'audio');
		assert.equal(clip.timelineStartFrame, programmeRate / 2);
		assert.equal(clip.durationFrames, programmeRate);
		assert.equal(clip.sourceDurationFrames, sourceRate);
		assert.deepEqual(fixture.switched, [opened.project.id]);
	});
}
