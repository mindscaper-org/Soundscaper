/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { writeDawprojectArchive } from '../src/common/editor/dawproject-archive.ts';
import { createNativeProjectService } from '../src/common/editor/controller/document/native-project-service.ts';
import { encodeWav } from '../src/common/editor/wav.js';
import { createFixture } from './helpers/native-project-service-fixture.ts';

const RATE = 48_000;
const SOURCE_FRAMES = RATE * 60;

for (const difference of [-144, 144, 0]) {
	test(`File Open preserves a DAWproject fine stretch of ${difference} samples per minute`, async () => {
		const durationFrames = SOURCE_FRAMES + difference;
		const fixture = createFixture();
		const opened = await createNativeProjectService(fixture.runtime).openDawproject(await recording(durationFrames));
		assert.ok(opened);
		assert.equal(opened.project.clips.length, 1);
		const clip = opened.project.clips[0];
		assert.ok(clip);
		assert.equal(clip.durationFrames, durationFrames, 'the authored synchronization boundary must survive import');
		assert.equal(clip.sourceDurationFrames, SOURCE_FRAMES, 'the entire unchanged recording remains available');
		assert.equal(clip.speedRatio, SOURCE_FRAMES / durationFrames);
	});
}

async function recording(durationFrames: number): Promise<File> {
	const seconds = durationFrames / RATE;
	const body = await writeDawprojectArchive({
		metadataXml: '<MetaData><Title>Fine synchronization</Title></MetaData>',
		projectXml: `<Project version="1.0"><Structure><Track id="track" contentType="audio"><Channel role="regular"/></Track></Structure>
			<Arrangement><Lanes timeUnit="seconds" track="track"><Clips><Clip time="0" duration="${seconds}">
			<Warps timeUnit="seconds" contentTimeUnit="seconds"><Audio timeUnit="seconds" duration="60" channels="1" sampleRate="48000"><File path="recording.wav"/></Audio>
			<Warp time="0" contentTime="0"/><Warp time="${seconds}" contentTime="60"/></Warps>
			</Clip></Clips></Lanes></Arrangement></Project>`,
		files: [{ path: 'recording.wav', blob: new Blob([Uint8Array.from(encodeWav(
			[new Float32Array(SOURCE_FRAMES).fill(.25)], { sampleRate: RATE, float: true }))]) }],
	});
	return new File([body], 'Fine synchronization.dawproject');
}
