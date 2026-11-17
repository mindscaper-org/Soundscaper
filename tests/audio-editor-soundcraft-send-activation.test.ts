/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { parseTimelineInterchange } from '../src/common/editor/timeline-interchange-import.ts';
import { buildTimelineInterchangeProject } from '../src/common/editor/timeline-interchange-project.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { soundcraftSession } from './helpers/native-daw-import-fixtures.ts';

test('opening a SoundCraft session retains disabled sends instead of making them audible', () => {
	for (const mute of [false, true]) {
		const fixture = soundcraftSession();
		const session = { ...fixture, busses: [{ id: 80, name: 'Reverb', format: 'Stereo' }],
			tracks: fixture.tracks.map(track => ({ ...track, mixer: { ...track.mixer,
				sends: [{ target: { Bus: 80 }, level_db: -6, pan: 0, mute, pre_fader: false }] } })) };
		let ordinal = 0;
		const document = parseTimelineInterchange('Send.scraft', JSON.stringify(session));
		const plan = buildTimelineInterchangeProject(document, { createStableId: prefix => `${prefix}-${++ordinal}` });
		const project = createSoundscaperProject({ ...plan.project, mixer: plan.production.mixer });
		const send = project.mixer.edges.find(edge => edge.kind === 'send');
		assert.ok(send);
		assert.equal(send.enabled, !mute);
		assert.equal(send.level, 10 ** (-6 / 20));
	}
});
