/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { parseDawprojectDocument } from '../src/common/editor/dawproject-import.ts';
import { buildDawprojectProject } from '../src/common/editor/dawproject-import-project.ts';
import { createCurrentAudioEditorProject } from '../src/common/editor/project-current.ts';

test('DAWproject import discloses audible static-fader gain reduction', () => {
	const document = parseDawprojectDocument(`<Project version="1.0"><Application name="Fixture" version="1"/>
		<Structure><Track id="track" contentType="audio"><Channel id="channel" role="regular" audioChannels="1">
		<Volume value="8" unit="linear"/></Channel></Track></Structure><Arrangement><Lanes timeUnit="seconds" track="track">
		<Clips><Clip time="0" duration="1" contentTimeUnit="seconds"><Audio duration="1" channels="1" sampleRate="48000">
		<File path="audio/take.wav"/></Audio></Clip></Clips></Lanes></Arrangement></Project>`);
	let nextId = 0;
	const plan = buildDawprojectProject(document, { media: new Map([['audio/take.wav', { frameCount: 48_000, sampleRate: 48_000, channelCount: 1 }]]),
		createStableId: prefix => `${prefix}-${++nextId}` });
	const project = createCurrentAudioEditorProject(plan.project);
	assert.equal(project.tracks[0]?.gain, 4);
	const conversion = plan.report.items.find(item => item.code === 'dawproject.static-gain-clamped');
	assert.ok(conversion, 'the report must disclose that the imported audio plays at half the declared fader gain');
	assert.equal(conversion.disposition, 'converted');
	assert.deepEqual(conversion.data, { authoredGain: 8, importedGain: 4, maximum: 4 });
});
