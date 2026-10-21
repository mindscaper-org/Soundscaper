/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createNativeProjectService } from '../src/common/editor/controller/document/native-project-service.ts';
import { writeDawprojectArchive } from '../src/common/editor/dawproject-archive.ts';
import { encodeWav } from '../src/common/editor/wav.js';
import { createFixture } from './helpers/native-project-service-fixture.ts';

async function open(lanes: string) {
	const archive = await writeDawprojectArchive({
		metadataXml: '<MetaData/>',
		projectXml: `<Project><Structure><Track id="recording" name="Recording" contentType="audio">
			<Channel role="regular"><Volume id="gain" value="0.5" unit="linear"/></Channel>
			</Track></Structure><Arrangement><Lanes timeUnit="seconds">${lanes}</Lanes></Arrangement></Project>`,
		files: [{ path: 'take.wav', blob: new Blob([encodeWav([new Float32Array(48_000)],
			{ sampleRate: 48_000, float: true }) as Uint8Array<ArrayBuffer>]) }],
	});
	Object.defineProperty(archive, 'name', { value: 'Recording.dawproject' });
	let id = 0;
	const fixture = createFixture({ createStableId: (prefix) => `${prefix}-${String(++id)}` });
	const result = await createNativeProjectService(fixture.runtime).openDawproject(archive as Blob & { name: string });
	assert.ok(result);
	return result.project as typeof result.project & {
		tracks: { name: string; clipIds: string[]; envelope: { frame: number; value: number }[] }[];
	};
}

test('MP09: DAWproject track references on Clips timelines attach audio to the declared channel', async () => {
	const project = await open(`<Clips track="recording"><Clip time="0" duration="1">
		<Audio timeUnit="seconds"><File path="take.wav"/></Audio></Clip></Clips>`);
	assert.equal(project.tracks.length, 1);
	assert.equal(project.tracks[0]!.name, 'Recording');
	assert.equal(project.tracks[0]!.clipIds.length, 1);
});

test('MP10: DAWproject volume automation crossing timeline zero keeps its gain at the visible origin', async () => {
	const project = await open(`<Points unit="linear"><Target parameter="gain"/>
		<RealPoint time="-1" value="0" interpolation="linear"/>
		<RealPoint time="1" value="1" interpolation="hold"/></Points>`);
	assert.deepEqual(project.tracks[0]!.envelope, [{ frame: 0, value: 0.5 }, { frame: 48_000, value: 1 }]);
});

test('MP11: nested DAWproject clips retain parent fade positions and combine their gains', async () => {
	const project = await open(`<Lanes track="recording"><Clips><Clip time="0" duration="10"
		fadeTimeUnit="seconds" fadeInTime="2" fadeOutTime="2"><Clips>
		<Clip time="5" duration="1"><Audio timeUnit="seconds"><File path="take.wav"/></Audio></Clip>
		</Clips></Clip></Clips></Lanes>`);
	const clip = project.clips[0] as unknown as { fadeInFrames: number; fadeOutFrames: number; envelope: { frame: number; value: number }[] };
	assert.equal(clip.fadeInFrames, 0);
	assert.equal(clip.fadeOutFrames, 0);
	assert.ok(clip.envelope.every((point) => point.value === 1));
	const combined = await open(`<Lanes track="recording"><Clips><Clip time="0" duration="4"
		fadeTimeUnit="seconds" fadeInTime="2"><Clips><Clip time="1" duration="1"
		fadeTimeUnit="seconds" fadeInTime="1"><Audio timeUnit="seconds"><File path="take.wav"/></Audio></Clip>
		</Clips></Clip></Clips></Lanes>`);
	const combinedClip = combined.clips[0] as unknown as typeof clip;
	assert.equal(combinedClip.envelope.find((point) => point.frame === 24_000)?.value, 0.375);
});
