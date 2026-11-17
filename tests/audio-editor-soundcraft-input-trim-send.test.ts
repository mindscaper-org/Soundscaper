/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { parseTimelineInterchange } from '../src/common/editor/timeline-interchange-import.ts';
import { buildTimelineInterchangeProject } from '../src/common/editor/timeline-interchange-project.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { soundcraftInputTrimSession } from './helpers/soundcraft-input-trim-fixture.ts';

for (const preFader of [true, false]) for (const automated of [true, false]) test(`SoundCraft input trim reaches ${preFader ? 'pre' : 'post'}-fader sends with automation=${automated}`, () => {
	const document = parseTimelineInterchange('Trim.scraft', JSON.stringify(soundcraftInputTrimSession(preFader, automated)));
	let serial = 0;
	const plan = buildTimelineInterchangeProject(document, { createStableId: prefix => `${prefix}-${++serial}` });
	const project = createSoundscaperProject({ ...plan.project, mixer: plan.production.mixer });
	const send = project.mixer.edges.find(edge => edge.kind === 'send'); assert.ok(send);
	const lane = project.automationLanes.find(lane => lane.address.kind === 'edge' && lane.address.edgeId === send.id);
	const stripGain = preFader ? 1 : Number(project.tracks[0]!.gain);
	assert.ok(Math.abs(send.level * stripGain - .5) < .000001, 'the cue must retain the -6 dB input trim');
	if (automated) { assert.ok(lane); assert.ok(lane.points.every(point => Math.abs(point.value * stripGain - .5) < .000001)); }
});
