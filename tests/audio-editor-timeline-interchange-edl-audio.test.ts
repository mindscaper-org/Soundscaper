/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createProjectEdlExport } from '../src/common/editor/edl-project-adapter.ts';
import { parseTimelineInterchange } from '../src/common/editor/timeline-interchange-import.ts';
import { createEdlExport } from '../src/common/editor/edl-export.ts';

const project = {
	id: 'project', title: 'Audio cuts', sampleRate: 48000,
	sequences: [{ id: 'main', rate: { num: 25, den: 1 }, dropFrame: false }], primarySequenceId: 'main',
	sources: [{ kind: 'audio', id: 'source', name: 'original.wav', storageKey: 'pcm-source', sampleRate: 96000 }],
	clips: [{ id: 'clip', kind: 'audio', title: 'Phrase', sourceId: 'source', timelineStartFrame: 48000, durationFrames: 96000, sourceStartFrame: 192000 }],
	tracks: [{ id: 'silent', name: 'Muted', type: 'audio', mute: true, clipIds: ['clip'] }, { id: 'audible', name: 'Music', type: 'audio', clipIds: ['clip'] }],
};

test('audio-only EDL export selects the first audible track and retains its source sample rate', () => {
	const result = createProjectEdlExport({ project });
	assert.match(result.text, /^001 ORIGINAL A C\s+00:00:02:00 00:00:04:00 00:00:01:00 00:00:03:00$/mu);
	assert.match(result.text, /^\* SOURCE FILE: original.wav$/mu);
	assert.match(result.text, /^\* FPS: 25\/1$/mu);
	assert.ok(!result.report.items.some(item => item.code === 'edl.audio-track-omitted'));
	const imported = parseTimelineInterchange('cuts.edl', result.text);
	assert.deepEqual(imported.rate, { num: 25, den: 1 });
	assert.equal(imported.media[0]?.path, 'original.wav');
	assert.equal(imported.tracks[0]?.kind, 'audio');
	assert.deepEqual(imported.tracks[0]?.clips[0]?.start, { num: 1, den: 1 });
	assert.deepEqual(imported.tracks[0]?.clips[0]?.sourceStart, { num: 2, den: 1 });
});

test('an explicit EDL audio track can be selected alongside a visible video track', () => {
	const video = { id: 'picture', type: 'video', clipIds: [] };
	const result = createProjectEdlExport({ project: { ...project, tracks: [video, ...project.tracks] }, trackId: 'audible' });
	assert.match(result.text, /^001 ORIGINAL A C/mu);
	assert.throws(() => createProjectEdlExport({ project, trackId: 'silent' }), /missing|does not/iu);
});

test('source file comments cannot inject EDL records', () => {
	const result = createEdlExport({ title: 'Cut', rate: { num: 25, den: 1 }, events: [{ reel: 'AX', trackKind: 'A', sourceInFrames: 0, sourceOutFrames: 25, recordInFrames: 0, recordOutFrames: 25, sourceFile: 'original.wav\nTITLE: injected' }] });
	assert.equal(result.text.split('\n').filter(line => line.startsWith('TITLE:')).length, 1);
	assert.match(result.text, /^\* SOURCE FILE: original.wav TITLE: injected$/mu);
});
