/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { parseTimelineInterchange } from '../src/common/editor/timeline-interchange-import.ts';
import { buildTimelineInterchangeProject } from '../src/common/editor/timeline-interchange-project.ts';
import { createSoundscaperProject, validateSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { soundcraftSession } from './helpers/native-daw-import-fixtures.ts';

for (const output of ['None', { Bus: 99 }]) test(`a SoundCraft track with output ${JSON.stringify(output)} still opens silently`, () => {
	const fixture = soundcraftSession();
	const session = { ...fixture, tracks: fixture.tracks.map(track => ({ ...track, mixer: { volume_db: 0, pan: [0], mute: false, solo: false,
		output, sends: [],
	} })) };
	let serial = 0;
	const plan = buildTimelineInterchangeProject(parseTimelineInterchange('Unrouted.scraft', JSON.stringify(session)), { createStableId: prefix => `${prefix}-${++serial}` });
	const project = createSoundscaperProject({ ...plan.project, mixer: plan.production.mixer });
	assert.equal(validateSoundscaperProject(project), true);
	assert.equal(project.clips.length, 1);
	const assignment = project.mixer.edges.find(edge => edge.source.kind === 'track');
	assert.ok(assignment?.enabled);
	assert.equal(assignment.level, 0, 'a structural output route must not make disconnected media audible');
});
