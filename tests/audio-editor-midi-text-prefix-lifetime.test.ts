/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createMidiImportFiles } from '../src/common/editor/controller/composition/internal/midi-import-files.ts';
import { parseMidiFile, writeMidiFile } from '../src/common/editor/midi-file.ts';
import { writeAllegroFile } from '../src/common/editor/allegro-file.ts';
import { normalizeMidiClipData, readMidiClip } from '../src/common/editor/midi-model.ts';
import { validateAudioEditorProjectV17 } from '../src/common/editor/project-v17.ts';
import { midiServiceFixture } from './helpers/midi-service-fixture.ts';

const prefix = [255, 32, 1, 2], lyric = [255, 5, 2, 104, 105];
const scoped = /text.*channel.*(association|prefix)|channel.*text.*(association|prefix)/iu;
function smf(events: readonly (readonly number[])[]): Uint8Array<ArrayBuffer> {
	const track = [0, 255, 81, 3, 7, 161, 32, ...events.flat(), 0, 255, 47, 0];
	return Uint8Array.from([77, 84, 104, 100, 0, 0, 0, 6, 0, 0, 0, 1, 1, 224,
		77, 84, 114, 107, track.length >>> 24, track.length >>> 16 & 255, track.length >>> 8 & 255, track.length & 255, ...track]);
}
function textEvents(bytes: Uint8Array) { return parseMidiFile(bytes, { sampleRate: 8000 }).tracks.flatMap(track => track.events ?? []).filter(event => event.metaType === 5); }

for (const trim of [0, 2000]) test(`FileImport/native save/MIDI export retains pending lyric scope after left trim ${trim}`, async () => {
	const bytes = smf([[0, ...prefix], [0x83, 0x60, ...lyric], [0x83, 0x60, 0x92, 60, 90], [0x83, 0x60, 0x82, 60, 0]]);
	const fixture = midiServiceFixture();
	await createMidiImportFiles({ getProject: fixture.project, importFiles: () => assert.fail('MIDI import') }, async () => fixture.service).importFiles([new File([bytes], 'Scoped lyric.mid')]);
	const clip = fixture.project().clips[0]; assert.ok(clip);
	if (trim) await fixture.service.resizeClip(clip.id, { timelineStartFrame: 0, sourceStartFrame: trim, durationFrames: 16_000 - trim });
	const native: unknown = JSON.parse(JSON.stringify(fixture.project())); assert.ok(validateAudioEditorProjectV17(native));
	assert.equal(readMidiClip(native.clips[0])?.interchange?.events.find(event => event.metaType === 5)?.textChannel, 2);
	const reopened = midiServiceFixture({ ...native });
	await reopened.service.exportFile('midi'); const delivered = reopened.saves[0]?.bytes; assert.ok(delivered instanceof Uint8Array);
	assert.equal(textEvents(delivered)[0]?.textChannel, 2);
});

test('a normal NoteOn retires a prefix before same-tick text, and export refuses to rescope it', async () => {
	const document = parseMidiFile(smf([[0, ...prefix], [0, 0x92, 60, 90], [0, ...lyric], [0x83, 0x60, 0x82, 60, 0]]), { sampleRate: 8000 });
	assert.equal(document.tracks[0]?.events?.find(event => event.metaType === 5)?.textChannel, null);
	const fixture = midiServiceFixture(); await fixture.service.importDocument(document);
	await assert.rejects(fixture.service.exportFile('midi'), scoped);
	assert.equal(fixture.saves.length, 0);
});

test('a normal NoteOff retires a prefix before same-tick global text', () => {
	const document = parseMidiFile(smf([[0, 0x92, 60, 90], [0x83, 0x60, ...prefix], [0, 0x82, 60, 0], [0, ...lyric]]), { sampleRate: 8000 });
	assert.equal(document.tracks[0]?.events?.find(event => event.metaType === 5)?.textChannel, null);
	assert.throws(() => writeMidiFile(document), scoped);
});

test('same-tick text before a NoteOn keeps its scoped association', () => {
	const document = parseMidiFile(smf([[0, ...prefix], [0, ...lyric], [0, 0x92, 60, 90], [0x83, 0x60, 0x82, 60, 0]]), { sampleRate: 8000 });
	assert.equal(textEvents(writeMidiFile(document))[0]?.textChannel, 2);
});

test('an intervening retained controller safely retires the prefix before same-tick global text', () => {
	const document = parseMidiFile(smf([[0, ...prefix], [0, 0xb2, 7, 90], [0, ...lyric], [0, 0x92, 60, 90], [0x83, 0x60, 0x82, 60, 0]]), { sampleRate: 8000 });
	assert.equal(textEvents(writeMidiFile(document))[0]?.textChannel, null);
});

test('global text before an initial prefix remains global beside later scoped text', () => {
	const document = parseMidiFile(smf([[0, ...lyric], [0, ...prefix], [0, ...lyric], [0, 0x92, 60, 90], [0x83, 0x60, 0x82, 60, 0]]), { sampleRate: 8000 });
	assert.deepEqual(textEvents(writeMidiFile(document)).map(event => event.textChannel), [null, 2]);
});

test('text provenance is strict, preserves explicit global scope and leaves legacy carriers unchanged', () => {
	const value = (textChannel: unknown) => ({ version: 1, notes: [], interchange: { events: [{ frame: 0, status: 255, metaType: 5, data: [104], textChannel }], tempos: [], signatures: [] } });
	for (const textChannel of [null, 0, 15]) assert.equal(normalizeMidiClipData(value(textChannel)).interchange?.events[0]?.textChannel, textChannel);
	for (const textChannel of [-1, 16, 0.5, false, '2']) assert.throws(() => normalizeMidiClipData(value(textChannel)), /text.*channel|channel.*text/iu);
	assert.equal(Object.hasOwn(normalizeMidiClipData(value(undefined)).interchange?.events[0] ?? {}, 'textChannel'), false);
	assert.throws(() => normalizeMidiClipData({ version: 1, notes: [], interchange: { events: [{ frame: 0, status: 176, data: [7, 90], textChannel: 2 }], tempos: [], signatures: [] } }), /text.*channel|channel.*text/iu);
});

test('Allegro cannot silently turn retained scoped text into global text after trimming drops its prefix', () => {
	assert.throws(() => writeAllegroFile({ sampleRate: 8000, tempos: [], signatures: [], tracks: [{ name: 'Text', notes: [], events: [{ frame: 0, status: 255, metaType: 5, data: [104], textChannel: 2 }] }] }), scoped);
});

test('scoped track names refuse their unsupported representation while a channel message retires the name prefix', () => {
	assert.throws(() => parseMidiFile(smf([[0, ...prefix], [0, 255, 3, 1, 65], [0, 0x92, 60, 90], [0x83, 0x60, 0x82, 60, 0]])), /channel.*track.*name|track.*name.*channel/iu);
	assert.equal(parseMidiFile(smf([[0, ...prefix], [0, 0x92, 60, 90], [0, 255, 3, 1, 65], [0x83, 0x60, 0x82, 60, 0]])).tracks[0]?.name, 'A');
});

test('injected text prefixes count against the existing MIDI reader event budget', () => {
	const events = Array.from({ length: 125_000 }, (_, index) => ({ frame: index, status: 255, metaType: 5, data: [104], textChannel: index % 2 }));
	assert.throws(() => writeMidiFile({ sampleRate: 8000, tempos: [], signatures: [], tracks: [{ name: 'Many scopes', notes: [], events }] }), /reader event limit/iu);
});


test('left trimming after an actual channel reset retains global lyrics without installing a prefix', async () => {
	const fixture = midiServiceFixture();
	const [created] = await fixture.service.importDocument(parseMidiFile(smf([[0, ...prefix], [0, 0x92, 60, 90], [0x81, 0x70, 0x82, 60, 0], [0x81, 0x70, ...lyric]]), { sampleRate: 8000 }));
	assert.ok(created);
	await fixture.service.resizeClip(created.clipId, { timelineStartFrame: 0, sourceStartFrame: 3000, durationFrames: 13_000 });
	await fixture.service.exportFile('midi'); const bytes = fixture.saves[0]?.bytes; assert.ok(bytes instanceof Uint8Array);
	const events = parseMidiFile(bytes).tracks.flatMap(track => track.events ?? []);
	assert.deepEqual(events.filter(event => event.metaType === 32), []);
	assert.deepEqual(events.filter(event => event.metaType === 5).map(event => event.data), [[104, 105]]);
});

test('Allegro global text with explicit known scope remains representable', () => {
	const text = writeAllegroFile({ sampleRate: 8000, tempos: [], signatures: [], tracks: [{ name: 'Global', notes: [],
		events: [{ frame: 0, status: 255, metaType: 5, data: [104, 105], textChannel: null }] }] });
	assert.match(text, /V- -lyrics:"hi"/u);
});
