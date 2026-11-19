/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { readMidiClip, readMidiTrack } from '../src/common/editor/midi-model.ts';
import { midiImportArchiveCustody } from './helpers/midi-import-archive-custody.ts';
import { ardourMidiBytes, ardourMidiSession, soundcraftMidiSession } from './helpers/project-midi-import-fixtures.ts';
import { NodeMidiWorker } from './helpers/node-midi-worker.ts';

class ImportMidiWorker extends NodeMidiWorker {
	constructor(url: string | URL) { assert.match(String(url), /midi-render-worker-entry\.ts$/u); super(); }
}

for (const format of ['ardour', 'scraft'] as const) test(`${format} editable notes and audible synthesis survive actual controller import and Scape reopening`, async context => {
	const worker = globalThis.Worker;
	globalThis.Worker = ImportMidiWorker as unknown as typeof Worker;
	context.after(() => { globalThis.Worker = worker; });
	const runtime = await midiImportArchiveCustody(context);
	const session = soundcraftMidiSession();
	const files = format === 'ardour' ? [new File([ardourMidiSession()], 'notes.ardour'), new File([ardourMidiBytes()], 'keys.mid')]
		: [new File([JSON.stringify({ ...session, tracks: [session.tracks[1]] })], 'notes.scraft')];
	await runtime.controller.actions.project.importFiles(files);
	const recipient = await runtime.reopen();
	assert.equal(recipient.project.clips.length, 1);
	assert.equal(recipient.project.sources.length, 1);
	assert.equal(readMidiTrack(recipient.project.tracks[0])?.instrument, 'triangle');
	const clip = recipient.project.clips[0]!;
	const data = readMidiClip(clip)!;
	assert.ok(data);
	assert.deepEqual(data.notes.map(note => [note.pitch, note.channel, note.velocity, note.releaseVelocity, note.startFrame, note.durationFrames]),
		[[64, 2, 100, 32, 24000, format === 'ardour' ? 24000 : 96000]]);
	assert.equal(clip.timelineStartFrame, format === 'ardour' ? 48000 : 24000);
	assert.equal(clip.sourceStartFrame, format === 'ardour' ? 24000 : 0);
	assert.equal(clip.durationFrames, format === 'ardour' ? 48000 : 96000);
	assert.deepEqual(data.interchange?.events.map(event => [event.frame, event.status, ...event.data]), format === 'ardour'
		? [[0, 0xc2, 12], [0, 0xb2, 64, 127], [72000, 0xb2, 64, 0]]
		: [[0, 0xc2, 12], [24000, 0xb2, 64, 127]]);
});
