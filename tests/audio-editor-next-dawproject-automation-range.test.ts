/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createNativeProjectService } from '../src/common/editor/controller/document/native-project-service.ts';
import { writeDawprojectArchive } from '../src/common/editor/dawproject-archive.ts';
import { encodeWav } from '../src/common/editor/wav.js';
import { importSoundscaperAudacityProject } from '../src/soundscaper/editor-audacity-project-import.ts';
import { validateSoundscaperProject } from '../src/soundscaper/editor-project-validation.ts';
import { evaluateAutomationLaneAtFrameV21 } from '../src/common/editor/automation-lane-v21.ts';
import { createFixture } from './helpers/native-project-service-fixture.ts';

test('File Open retains healthy audio and reports volume automation beyond the supported strip range', async () => {
	const archive = await writeDawprojectArchive({ metadataXml: '<MetaData/>',
		files: [{ path: 'take.wav', blob: new Blob([Uint8Array.from(encodeWav([new Float32Array(48_000)], { sampleRate: 48_000, float: true }))]) }],
		projectXml: `<Project version="1.0"><Structure><Track id="track" name="Recording" contentType="audio">
			<Channel role="regular"><Volume id="volume" unit="linear" value="1"/></Channel></Track></Structure>
			<Arrangement><Lanes timeUnit="seconds"><Lanes track="track"><Clips><Clip time="0" duration="1">
			<Audio timeUnit="seconds"><File path="take.wav"/></Audio></Clip></Clips>
			<Points unit="linear"><Target parameter="volume"/><RealPoint time="0" value="1" interpolation="linear"/>
			<RealPoint time="1" value="8"/></Points></Lanes></Lanes></Arrangement></Project>`,
	});
	Object.defineProperty(archive, 'name', { value: 'Loud automation.dawproject' });
	let ordinal = 0;
	const fixture = createFixture({ createStableId: prefix => `${prefix}-${++ordinal}`,
		adaptAudacityProject: importSoundscaperAudacityProject });
	const opened = await createNativeProjectService(fixture.runtime).openDawproject(archive as Blob & { name: string });
	assert.ok(opened);
	assert.ok(validateSoundscaperProject(opened.project));
	assert.equal(opened.project.clips.length, 1, 'out-of-range controls must not discard otherwise playable media');
	const lane = opened.project.automationLanes[0]; assert.ok(lane);
	assert.equal(lane.points[0]?.value, 1); assert.equal(lane.points.at(-1)?.value, 4);
	assert.ok(Math.abs(evaluateAutomationLaneAtFrameV21(lane, 12_000, { sampleRate: 48_000 }) - 2.75) < 1e-4,
		'clipping an over-range endpoint must preserve the still-supported portion of the original ramp');
	assert.equal(evaluateAutomationLaneAtFrameV21(lane, 24_000, { sampleRate: 48_000 }), 4);
	const report = fixture.runtime.state.deliveryReport;
	assert.ok(report && typeof report === 'object');
	assert.ok('items' in report && Array.isArray(report.items));
	assert.ok(report.items.some((item: unknown) => item && typeof item === 'object'
		&& 'code' in item && item.code === 'dawproject.automation-gain-clamped'));
});
