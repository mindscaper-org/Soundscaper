/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { parseArdourDocument } from '../src/common/editor/ardour-import.ts';
import { buildTimelineInterchangeProject } from '../src/common/editor/timeline-interchange-project.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { ardourSession } from './helpers/native-daw-import-fixtures.ts';
import { ardourMidiSession, ardourMidiBytes } from './helpers/project-midi-import-fixtures.ts';

function open(text: string, midi = false) {
	let ordinal = 0;
	const document = parseArdourDocument(text);
	const plan = buildTimelineInterchangeProject(document, { createStableId: prefix => `${prefix}-${++ordinal}`,
		...(midi ? { midiFiles: new Map([[document.media[0]!.id, ardourMidiBytes()]]) } : {}) });
	return createSoundscaperProject({ ...plan.project, mixer: plan.production.mixer });
}

test('opening an Ardour session retains bus mute and solo state', () => {
	for (const controls of ['muted="yes" soloed="yes"', 'self-solo="1"']) {
		const xml = ardourSession().replace('</Routes>', `<Route id="return" name="Return" default-type="audio" ${controls}><MuteMaster muted="1"/></Route></Routes>`);
		const bus = open(xml).mixer.groups[0]!;
		assert.equal(bus.mute, true);
		assert.equal(bus.solo, true);
	}
});

test('opening an Ardour MIDI track retains MuteMaster state', () => {
	const project = open(ardourMidiSession().replace('midi-playlist="30"/>', 'midi-playlist="30"><MuteMaster muted="1"/></Route>'), true);
	assert.equal(project.tracks[0]!.mute, true);
});

test('opening a legacy Ardour bus retains its single-channel panner', () => {
	const xml = ardourSession().replace('</Routes>', '<Route id="return" name="Return" default-type="audio"><IO><Panner><StreamPanner x="0.125"/></Panner></IO></Route></Routes>');
	assert.equal(open(xml).mixer.groups[0]!.pan, -.75);
});
