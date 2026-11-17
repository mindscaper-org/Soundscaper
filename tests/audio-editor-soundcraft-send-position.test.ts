/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { parseTimelineInterchange } from '../src/common/editor/timeline-interchange-import.ts';
import { buildTimelineInterchangeProject } from '../src/common/editor/timeline-interchange-project.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { soundcraftSession } from './helpers/native-daw-import-fixtures.ts';

for (const preFader of [false, true]) test(`SoundCraft sends retain their authored ${preFader ? 'pre' : 'post'}-fader tap`, () => {
	const fixture = soundcraftSession();
	const session = { ...fixture, busses: [{ id: 80, name: 'Cue', format: 'Stereo' }], tracks: fixture.tracks.map(track => ({ ...track,
		mixer: { volume_db: -30, pan: [0], sends: [{ target: { Bus: 80 }, level_db: 0, pan: 0, mute: false, pre_fader: preFader }] },
	})) };
	let serial = 0;
	const plan = buildTimelineInterchangeProject(parseTimelineInterchange('Cue.scraft', JSON.stringify(session)), { createStableId: prefix => `${prefix}-${++serial}` });
	const project = createSoundscaperProject({ ...plan.project, mixer: plan.production.mixer });
	assert.equal(project.mixer.edges.find(edge => edge.kind === 'send')?.position, preFader ? 'pre-fader' : 'post-fader');
});
