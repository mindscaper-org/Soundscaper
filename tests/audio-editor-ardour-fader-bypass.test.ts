/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { parseArdourDocument } from '../src/common/editor/ardour-import.ts';
import { buildTimelineInterchangeProject } from '../src/common/editor/timeline-interchange-project.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { ardourSession } from './helpers/native-daw-import-fixtures.ts';

for (const active of [false, true]) test(`opening an Ardour ${active ? 'active' : 'bypassed'} fader preserves its audible gain`, () => {
	const amp = `<Processor type="trim" active="1"><Controllable name="gaincontrol" value="0.5"/></Processor>
		<Processor type="amp" active="${active ? '1' : '0'}"><Controllable name="gaincontrol" value="0.125"/>
		<Automation><AutomationList automation-id="gain" state="Play"><events>0 .25\n48000 .5</events></AutomationList></Automation></Processor>`;
	const xml = ardourSession(true).replace('<Processor type="amp"><Controllable name="gaincontrol" value="0.5"/></Processor>', amp);
	let ordinal = 0;
	const plan = buildTimelineInterchangeProject(parseArdourDocument(xml), { createStableId: prefix => `${prefix}-${++ordinal}` });
	const project = createSoundscaperProject({ ...plan.project, mixer: plan.production.mixer });
	assert.equal(project.tracks[0]!.gain, active ? .0625 : .5);
	assert.equal(project.automationLanes.length, active ? 1 : 0);
	if (active) assert.deepEqual(project.automationLanes[0]!.points.map(point => point.value), [.125, .25]);
});
