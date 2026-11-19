/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { parseArdourDocument } from '../src/common/editor/ardour-import.ts';
import { buildTimelineInterchangeProject } from '../src/common/editor/timeline-interchange-project.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { ardourSession } from './helpers/native-daw-import-fixtures.ts';

test('File Open retains legacy Ardour master and bus IO gain alongside processor gain', () => {
	for (const master of [true, false]) {
		const input = ardourSession().replace('</Routes>', `<Route id="return" name="Return" default-type="audio"${master ? ' flags="MasterOut"' : ''}>
			<IO id="return-io" name="Return" gain=".25"/><Processor type="amp"><Controllable name="gaincontrol" value=".5"/></Processor></Route></Routes>`);
		const document = parseArdourDocument(input);
		assert.equal(master ? document.master?.gain : document.buses?.[0]?.gain, .125);
		let ordinal = 0;
		const plan = buildTimelineInterchangeProject(document, { createStableId: prefix => `${prefix}-${++ordinal}` });
		const project = createSoundscaperProject({ ...plan.project, mixer: plan.production.mixer });
		assert.equal(master ? project.master.gain : project.mixer.groups[0]?.gain, .125);
	}
});
