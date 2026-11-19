/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { parseArdourDocument } from '../src/common/editor/ardour-import.ts';
import { buildTimelineInterchangeProject } from '../src/common/editor/timeline-interchange-project.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { ardourSession } from './helpers/native-daw-import-fixtures.ts';

// Modern PresentationInfo ownership is documented in the pinned upstream
// libs/ardour/stripable.cc at 522303bf7cbfd7d74510eb96e7da0762ffa73237.
test('modern Ardour master and monitor routes retain their roles when opening a session', () => {
	for (const modern of [false, true]) {
		const flags = (flag: string) => modern ? `<PresentationInfo flags="${flag},OrderSet" order="9"/>` : '';
		const attribute = (flag: string) => modern ? '' : ` flags="${flag}"`;
		const input = ardourSession(modern).replace('</Pannable></Route>', '</Pannable><IO direction="Output"><Port><Connection other="Master/audio_in 1"/></Port></IO></Route>')
			.replace('</Routes>', `<Route id="master" name="Master" default-type="audio"${attribute('MasterOut')}>${flags('MasterOut')}<Processor type="amp"><Controllable name="gaincontrol" value=".25"/></Processor></Route>
			<Route id="monitor" name="Monitor" default-type="audio"${attribute('MonitorOut')}>${flags('MonitorOut')}</Route></Routes>`);
		const document = parseArdourDocument(input);
		assert.equal(document.master?.gain, .25);
		assert.equal(document.buses?.length, 0);
		assert.equal(document.tracks[0]?.output, undefined, 'the master is the programme output, not an auxiliary destination');
		let ordinal = 0;
		const plan = buildTimelineInterchangeProject(document, { createStableId: prefix => `${prefix}-${++ordinal}` });
		const project = createSoundscaperProject({ ...plan.project, mixer: plan.production.mixer });
		assert.equal(project.master.gain, .25);
		assert.equal(project.mixer.groups.length, 0);
	}
});
