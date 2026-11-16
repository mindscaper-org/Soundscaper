/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { interchangeAutomationLane } from '../src/common/editor/interchange-automation.ts';
import { evaluateAutomationLaneAtFrameV21 } from '../src/common/editor/automation-lane-v21.ts';
import { buildTimelineInterchangeProject } from '../src/common/editor/timeline-interchange-project.ts';
import { createCurrentAudioEditorProject } from '../src/common/editor/project-current.ts';
import { parseDawprojectDocument } from '../src/common/editor/dawproject-import.ts';
import { readDawprojectDeviceStates } from '../src/common/editor/dawproject-import-device-states.ts';
import type { DawprojectArchive } from '../src/common/editor/dawproject-archive.ts';
import type { TimelineInterchangeDocument } from '../src/common/editor/timeline-interchange-types.ts';

test('imported automation clips a crossing ramp at origin and preserves last duplicate value and holds', () => {
	let ordinal = 0;
	const lane = interchangeAutomationLane([{ frame: -100, value: 0, interpolation: 'linear' }, { frame: 100, value: .5, interpolation: 'hold' },
		{ frame: 100, value: 1, interpolation: 'hold' }, { frame: 200, value: 0, interpolation: 'linear' }],
		{ kind: 'strip', strip: { kind: 'master' }, parameterId: 'gain' }, () => `id-${++ordinal}`)!;
	assert.equal(evaluateAutomationLaneAtFrameV21(lane, 0, { sampleRate: 48000 }), .5);
	assert.equal(evaluateAutomationLaneAtFrameV21(lane, 150, { sampleRate: 48000 }), 1);
	assert.equal(evaluateAutomationLaneAtFrameV21(lane, 200, { sampleRate: 48000 }), 0);
});

test('shortened interchange clips retain their interpolated envelope boundary', () => {
	let ordinal = 0;
	const document: TimelineInterchangeDocument = { format: 'soundcraft', title: 'Shortened', sampleRate: 48000, rate: { num: 30, den: 1 }, dropFrame: false, startFrameCount: 0,
		media: [{ id: 'source', path: 'Voice.wav', name: 'Voice', kind: 'audio' }], issues: [], tracks: [{ id: 't', kind: 'audio', name: 'Voice',
			clips: [{ id: 'c', name: 'Voice', mediaId: 'source', start: { num: 0, den: 1 }, sourceStart: { num: 0, den: 1 }, duration: { num: 1, den: 1 }, envelope: [{ frame: 0, value: 1 }, { frame: 48000, value: 0 }] }] }] };
	const plan = buildTimelineInterchangeProject(document, { createStableId: prefix => `${prefix}-${++ordinal}`, media: new Map([['source', { sampleRate: 48000, frameCount: 24000, channelCount: 1 }]]) });
	const project = createCurrentAudioEditorProject(plan.project);
	assert.deepEqual(project.clips[0]?.envelope, [{ frame: 0, value: 1 }, { frame: 24000, value: .5 }]);
});

test('foreign state reader bounds inflation and never reads external or oversized state', async () => {
	const document = parseDawprojectDocument('<Project><Structure><Track><Channel><Devices><ClapPlugin><State path="large.state"/></ClapPlugin><ClapPlugin><State path="external.state" external="1"/></ClapPlugin></Devices></Channel></Track></Structure></Project>');
	let reads = 0;
	const archive: DawprojectArchive = { xmlMaximumBytes: 1024, projectXml: '', metadataXml: null, entryNames: [],
		entrySize: path => path === 'large.state' ? 17 * 1024 * 1024 : 1, readEntry: () => { reads++; return Promise.resolve(null); }, releaseEntry: () => Promise.resolve(), close: () => Promise.resolve() };
	assert.equal((await readDawprojectDeviceStates(document, archive, () => undefined)).size, 0);
	assert.equal(reads, 0);
});
