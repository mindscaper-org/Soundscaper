/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { parseArdourDocument } from '../src/common/editor/ardour-import.ts';
import { buildTimelineInterchangeProject } from '../src/common/editor/timeline-interchange-project.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { evaluateAutomationLaneAtFrameV21 } from '../src/common/editor/automation-lane-v21.ts';
import { ardourSession } from './helpers/native-daw-import-fixtures.ts';

test('split stereo Ardour imports keep their shared fader, balance and pan automation on one stereo bus', () => {
	const xml = ardourSession().replace('</Sources>', '<Source id="11" name="voice-R.wav" type="audio" channel="0"/></Sources>')
		.replace('source-0="10" channels="1"', 'source-0="10" source-1="11" channels="2"')
		.replace('</Pannable>', '<Automation><AutomationList automation-id="pan-azimuth" state="Play" interpolation-style="Linear"><events>0 .25\n48000 .75</events></AutomationList></Automation></Pannable>');
	let ordinal = 0;
	const plan = buildTimelineInterchangeProject(parseArdourDocument(xml), { createStableId: prefix => `${prefix}-${++ordinal}` });
	const project = createSoundscaperProject({ ...plan.project, mixer: plan.production.mixer });
	assert.deepEqual(project.tracks.map(track => track.pan), [-1, 1]);
	const bus = project.mixer.groups.find(bus => bus.name === 'Dialogue');
	assert.ok(bus, 'the original stereo strip must still own its balance and processing');
	assert.equal(bus.gain, .5); assert.equal(bus.pan, -.5); assert.equal(bus.solo, true);
	assert.deepEqual(project.tracks.map(track => track.gain), [1, 1]);
	assert.equal(project.automationLanes.length, 1);
	assert.deepEqual(project.automationLanes[0]!.address, { kind: 'strip', strip: { kind: 'mixer-node', id: bus.id }, parameterId: 'pan' });
	assert.equal(evaluateAutomationLaneAtFrameV21(project.automationLanes[0]!, 24000, { sampleRate: 48000 }), 0);
	for (const track of project.tracks) assert.ok(project.mixer.edges.some(edge => edge.source.kind === 'track' && edge.source.id === track.id
		&& edge.destination.kind === 'mixer-node' && edge.destination.id === bus.id));
});
