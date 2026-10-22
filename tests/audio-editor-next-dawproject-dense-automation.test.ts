/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createNativeProjectService } from '../src/common/editor/controller/document/native-project-service.ts';
import { writeDawprojectArchive } from '../src/common/editor/dawproject-archive.ts';
import { encodeWav } from '../src/common/editor/wav.js';
import { importSoundscaperAudacityProject } from '../src/soundscaper/editor-audacity-project-import.ts';
import { createFixture } from './helpers/native-project-service-fixture.ts';

for (const shape of ['ramp', 'triangle'] as const) test(`File Open retains audio with densely sampled ${shape} DAWproject automation`, async () => {
	const points = Array.from({ length: 6_001 }, (_, index) =>
		`<RealPoint time="${index / 1_000}" value="${shape === 'ramp' ? index / 6_000 : Math.min(index, 6_000 - index) / 3_000}" interpolation="linear"/>`).join('');
	const archive = await writeDawprojectArchive({ metadataXml: '<MetaData/>',
		files: [{ path: 'take.wav', blob: new Blob([Uint8Array.from(encodeWav([new Float32Array(288_000)], { sampleRate: 48_000, float: true }))]) }],
		projectXml: `<Project version="1.0"><Structure><Track id="track" name="Recording" contentType="audio">
			<Channel role="regular"><Volume id="volume" unit="linear" value="1"/></Channel></Track></Structure>
			<Arrangement><Lanes timeUnit="seconds"><Lanes track="track"><Clips><Clip time="0" duration="6">
			<Audio timeUnit="seconds"><File path="take.wav"/></Audio></Clip></Clips>
			<Points unit="linear"><Target parameter="volume"/>${points}</Points></Lanes></Lanes></Arrangement></Project>`,
	});
	Object.defineProperty(archive, 'name', { value: 'Sampled volume.dawproject' });
	let ordinal = 0;
	const fixture = createFixture({ createStableId: prefix => `${prefix}-${++ordinal}`,
		adaptAudacityProject: importSoundscaperAudacityProject });
	const opened = await createNativeProjectService(fixture.runtime).openDawproject(archive as Blob & { name: string });
	assert.ok(opened);
	assert.equal(opened.project.clips.length, 1);
	const lane = opened.project.automationLanes[0];
	assert.ok(lane);
	assert.deepEqual(lane.points.map(point => ({ position: point.position, value: point.value })), [
		{ position: 0, value: 0 }, ...(shape === 'triangle' ? [{ position: 144_000, value: 1 }] : []),
		{ position: 288_000, value: shape === 'ramp' ? 1 : 0 },
	], 'redundant samples retain the authored endpoints and change in slope within the persisted lane cap');
});
