/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { readMidiClip } from '../src/common/editor/midi-model.ts';
import { midiImportArchiveCustody } from './helpers/midi-import-archive-custody.ts';
import { NodeMidiWorker } from './helpers/node-midi-worker.ts';
import { exchangeMidiBytes, midiAttachmentAaf, midiReferenceOtio } from './helpers/interchange-midi-file-fixtures.ts';

class ExchangeMidiWorker extends NodeMidiWorker {
	constructor(url: string | URL) { assert.match(String(url), /midi-render-worker-entry\.ts$/u); super(); }
}

for (const format of ['AAF', 'OTIO'] as const) test(`${format} MIDI notes, messages and real synthesized PCM survive controller import and portable Scape reopening`, async context => {
	const worker = globalThis.Worker; globalThis.Worker = ExchangeMidiWorker as unknown as typeof Worker;
	context.after(() => { globalThis.Worker = worker; });
	const runtime = await midiImportArchiveCustody(context);
	const files = format === 'AAF' ? [new File([midiAttachmentAaf()], 'Score.aaf')]
		: [new File([midiReferenceOtio()], 'Score.otio'), new File([exchangeMidiBytes()], 'Score.mid')];
	await runtime.controller.actions.project.importFiles(files);
	const recipient = await runtime.reopen();
	assert.equal(recipient.project.tracks.length, 2);
	assert.equal(recipient.project.clips.length, 2);
	assert.deepEqual(recipient.project.clips.flatMap(clip => readMidiClip(clip)?.notes.map(note => [note.pitch, note.startFrame, note.durationFrames]) ?? []),
		[[64, 24000, 48000], [48, 0, 24000]]);
	assert.deepEqual(readMidiClip(recipient.project.clips[0])?.interchange?.events.map(event => [event.frame, event.status, ...event.data]), [[0, 176, 7, 100], [0, 192, 12]]);
	assert.deepEqual(readMidiClip(recipient.project.clips[0])?.interchange?.tempos, [{ frame: 0, bpm: 120 }, { frame: 24000, bpm: 60 }]);
	assert.equal(recipient.project.clips[0]?.timelineStartFrame, format === 'AAF' ? 0 : 48000);
	assert.equal(recipient.project.clips[0]?.sourceStartFrame, format === 'AAF' ? 0 : 24000);
});
