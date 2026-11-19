/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { openAsBlob } from 'node:fs';
import { mkdtemp, rmdir, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { MIDI_COMPACT_SCORE_FEATURE_ID, MIDI_COMPACT_SCORE_KEY } from '../src/common/editor/midi-compact-score.ts';
import { parseMidiFile, writeMidiFile } from '../src/common/editor/midi-file.ts';
import { MIDI_EXTENSION_KEY, readMidiClip, removeMidiClipData, withMidiClipData, type MidiClipData } from '../src/common/editor/midi-model.ts';
import { createProjectFeatureCompatibilityService } from '../src/common/editor/project-feature-compatibility-service.ts';
import { PRODUCT_PROFILES } from '../src/common/products.js';
import { midiImportArchiveCustody } from './helpers/midi-import-archive-custody.ts';
import { firstMidiClip } from './helpers/midi-chronology-custody-fixtures.ts';
import { denseMidiScoreFixture } from './helpers/dense-midi-score-fixture.ts';

test('a 25,000-note MIDI file remains editable after normal import and portable reopen', async context => {
	const runtime = await midiImportArchiveCustody(context);
	const folder = await mkdtemp(join(tmpdir(), 'scape-midi-score-'));
	const file = join(folder, 'Dense score.mid');
	await writeFile(file, denseMidiScoreFixture());
	context.after(async () => { await unlink(file); await rmdir(folder); });
	await runtime.controller.actions.project.importFiles([new File([await openAsBlob(file)], 'Dense score.mid')]);
	const imported = firstMidiClip(runtime.controller.project);
	const original = readMidiClip(imported);
	assert.ok(original);
	assert.equal(original.notes.length, 25_000);
	const edit = original.notes[10_000]!;
	await runtime.controller.actions.midi.updateNote(imported.id, edit.id, { pitch: 73 });
	const recipient = await runtime.reopen();
	const reopenedClip = firstMidiClip(recipient.project);
	const reopened = readMidiClip(reopenedClip);
	assert.deepEqual(reopened?.notes, original.notes.map(note => note.id === edit.id ? { ...note, pitch: 73 } : note));
	assert.deepEqual(reopened?.interchange, original.interchange);
	const withoutScoreCapability = createProjectFeatureCompatibilityService(PRODUCT_PROFILES.soundscaper.capabilities);
	assert.equal(withoutScoreCapability.evaluate(recipient.project)?.items.find(item => item.featureId === MIDI_COMPACT_SCORE_FEATURE_ID)?.availability, 'unknown');
	await recipient.controller.actions.midi.exportFile('midi');
	const delivered = runtime.saved.at(-1)?.bytes;
	assert.ok(delivered instanceof Uint8Array);
	const exportedNotes = parseMidiFile(delivered, { sampleRate: 48_000 }).tracks.flatMap(track => track.notes);
	assert.equal(exportedNotes.length, 25_000);
	assert.deepEqual(exportedNotes.slice(9_999, 10_002).map(note => [note.pitch, note.midiPort, note.releaseVelocity]),
		[[72, 2, 37], [49, 2, 37], [50, 2, 37]]);
	assert.deepEqual(exportedNotes[10_024] && [exportedNotes[10_024].pitch, exportedNotes[10_024].midiPort, exportedNotes[10_024].releaseVelocity], [73, 2, 37]);
});

test('compact scores preserve lossless authoring metadata and the legacy clip remains readable', () => {
	const data: MidiClipData = { version: 1, notes: [{ id: 'Note \ud800', startFrame: 2, durationFrames: 1,
		pitch: 60, velocity: 100, channel: 0, midiPort: 0, releaseVelocity: 0,
		onsetStop: { kind: 'all-notes-off', frame: 2, channel: 0, releaseId: 'Release \udfff', soundEndFrame: null } }],
	interchange: { events: [{ frame: 2, status: 176, data: [123, 0], releaseId: 'Release \udfff' }], tempos: [], signatures: [] } };
	const carrier = { kind: 'audio', opaqueExtensions: { untouched: 'value', [MIDI_EXTENSION_KEY]: data } };
	const compact = withMidiClipData(carrier, data, true);
	assert.deepEqual(readMidiClip(carrier), data);
	assert.deepEqual(readMidiClip(structuredClone(compact)), data);
	assert.ok(Object.hasOwn(compact.opaqueExtensions, MIDI_COMPACT_SCORE_KEY));
	assert.equal(Object.hasOwn(compact.opaqueExtensions, MIDI_EXTENSION_KEY), false);
	assert.deepEqual(removeMidiClipData(compact).opaqueExtensions, { untouched: 'value' });
	assert.throws(() => readMidiClip({ kind: 'audio', opaqueExtensions: { [MIDI_COMPACT_SCORE_KEY]: '{"version":1,"notes":[[1,2]]}' } }), /invalid compact MIDI note/iu);
});

test('a large score spread across small tracks fits a single Project Bin import', async context => {
	const runtime = await midiImportArchiveCustody(context);
	const tracks = Array.from({ length: 96 }, (_, lane) => ({ name: `Lane ${lane}`,
		notes: Array.from({ length: 200 }, (_, index) => ({ id: `note-${index}`, startFrame: 24 * index,
			durationFrames: 19, channel: Math.floor(lane / 12), pitch: 48 + lane % 12, velocity: 90 })) }));
	const bytes = writeMidiFile({ sampleRate: 48_000, tempos: [], signatures: [], tracks });
	await runtime.controller.actions.project.importFiles([new File([bytes], 'Many lanes.mid')], { destination: 'project-bin' });
	const project = runtime.controller.project;
	assert.ok(project);
	assert.equal(project.clips.length, 0);
	assert.equal(project.projectBin.clips.length, 96);
	assert.deepEqual(project.projectBin.clips.map(clip => readMidiClip(clip)?.notes.length), Array(96).fill(200));
});
