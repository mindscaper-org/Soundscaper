/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { parseArdourDocument } from '../src/common/editor/ardour-import.ts';
import { buildTimelineInterchangeProject } from '../src/common/editor/timeline-interchange-project.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { ardourSession } from './helpers/native-daw-import-fixtures.ts';

for (const active of [false, true]) test(`opening an Ardour ${active ? 'active' : 'inactive'} route retains its playback gate`, () => {
	const automation = '<Automation><AutomationList automation-id="mute" state="Play"><events>0 0\n48000 1</events></AutomationList></Automation>';
	const xml = ardourSession(true).replace('default-type="audio" audio-playlist', `active="${active ? '1' : '0'}" default-type="audio" audio-playlist`)
		.replace('</Pannable>', `</Pannable>${automation}`)
		.replace('</Routes>', `<Route id="return" name="Return" default-type="audio" active="${active ? '1' : '0'}">${automation}</Route></Routes>`);
	let ordinal = 0;
	const plan = buildTimelineInterchangeProject(parseArdourDocument(xml), { createStableId: prefix => `${prefix}-${++ordinal}` });
	const project = createSoundscaperProject({ ...plan.project, mixer: plan.production.mixer });
	assert.equal(project.tracks[0]!.mute, !active);
	assert.equal(project.mixer.groups.find(bus => bus.name === 'Return')!.mute, !active);
	assert.equal(project.automationLanes.filter(lane => lane.address.kind === 'strip' && lane.address.parameterId === 'mute').length, active ? 2 : 0,
		'inactive route automation must not re-enable the route');
});
