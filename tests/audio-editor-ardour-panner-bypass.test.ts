/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { parseArdourDocument } from '../src/common/editor/ardour-import.ts';
import { buildTimelineInterchangeProject } from '../src/common/editor/timeline-interchange-project.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { ardourSession } from './helpers/native-daw-import-fixtures.ts';

// Ardour's main-outs Delivery owns its PannerShell. Bypass is available in the
// panner context menu and copies stereo inputs directly instead of balancing them.
function session(bypassed: boolean, split: boolean) {
	let xml = ardourSession(true).replace('</Pannable>', '<Automation><AutomationList automation-id="pan-azimuth" state="Play"><events>0 .25\n48000 .75</events></AutomationList></Automation></Pannable>')
		.replace('</Route>', `<Processor type="main-outs"><PannerShell bypassed="${bypassed ? '1' : '0'}"/></Processor></Route>`);
	if (split) xml = xml.replace('</Sources>', '<Source id="11" name="voice-R.wav" type="audio" channel="0"/></Sources>')
		.replace('source-0="10" channels="1"', 'source-0="10" source-1="11" channels="2"');
	return xml;
}

for (const split of [false, true]) test(`opening an Ardour ${split ? 'split stereo' : 'audio'} track respects panner bypass`, () => {
	let ordinal = 0;
	const plan = buildTimelineInterchangeProject(parseArdourDocument(session(true, split)), { createStableId: prefix => `${prefix}-${++ordinal}` });
	const project = createSoundscaperProject({ ...plan.project, mixer: plan.production.mixer });
	if (split) {
		assert.deepEqual(project.tracks.map(track => track.pan), [-1, 1]);
		assert.equal(project.mixer.groups.find(bus => bus.name === 'Dialogue')?.pan, 0);
	} else assert.equal(project.tracks[0]!.pan, 0);
	assert.deepEqual(project.automationLanes, [], 'bypassed pan automation must not move the imported signal');
});

test('an active main panner retains its controls even when a send panner is bypassed', () => {
	const document = parseArdourDocument(session(false, false).replace('</Route>', '<Processor type="intsend" send-to="bus" active="0"><PannerShell bypassed="1"/></Processor></Route>'));
	assert.equal(document.tracks[0]!.pan, -.5);
	assert.equal(document.tracks[0]!.automation?.length, 1);
});
