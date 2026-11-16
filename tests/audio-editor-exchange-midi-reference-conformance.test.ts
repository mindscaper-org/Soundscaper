/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { parseAafDocument } from '../src/common/editor/aaf-import.ts';
import { buildTimelineInterchangeProject } from '../src/common/editor/timeline-interchange-project.ts';
import { createCurrentAudioEditorProject } from '../src/common/editor/project-current.ts';
import { readMidiClip } from '../src/common/editor/midi-model.ts';
import { createReferenceMidiAaf } from './helpers/aaf-midi-reference.ts';
import { exchangeMidiBytes } from './helpers/interchange-midi-file-fixtures.ts';

for (const slotKind of ['static', 'timeline', 'event'] as const) test(`independent AAF ${slotKind} auxiliary MIDI slots import alongside audio`, async () => {
	const document = parseAafDocument(createReferenceMidiAaf({ slotKind, audio: true }));
	const reference = document.media.find(item => item.midi); assert.ok(reference?.blob);
	let id = 0;
	const plan = buildTimelineInterchangeProject(document, { createStableId: prefix => `${prefix}-${++id}`,
		midiFiles: new Map([[reference.id, new Uint8Array(await reference.blob.arrayBuffer())]]) });
	const project = createCurrentAudioEditorProject(plan.project);
	assert.deepEqual(project.tracks.map(track => track.name), ['Dialogue', 'Melody', 'Bass']);
	assert.equal(project.clips[1]?.timelineStartFrame, 0);
	assert.equal(project.clips[1]?.durationFrames, 168000);
	assert.deepEqual(readMidiClip(project.clips[1])?.notes.map(note => [note.pitch, note.startFrame, note.durationFrames]), [[64, 24000, 48000]]);
	assert.equal(document.issues.some(issue => issue.code === 'aaf.track-kind-omitted' || issue.code === 'aaf.slot-kind-omitted'), false);
});

test('independently written linked AAF MIDI locators resolve companion bytes', () => {
	const document = parseAafDocument(createReferenceMidiAaf({ embedded: false }));
	const reference = document.media[0]!;
	assert.equal(reference.path, 'file:///MIDI/Score.mid');
	assert.equal(reference.blob, undefined);
	let id = 0;
	const plan = buildTimelineInterchangeProject(document, { createStableId: prefix => `${prefix}-${++id}`, midiFiles: new Map([[reference.id, exchangeMidiBytes()]]) });
	assert.equal(plan.midiSources.length, 2);
	assert.equal(plan.report.items.some(item => item.disposition === 'missing'), false);
});
