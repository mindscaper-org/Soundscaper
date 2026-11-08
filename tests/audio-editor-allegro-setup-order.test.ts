/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createMidiImportFiles } from '../src/common/editor/controller/composition/internal/midi-import-files.ts';
import { validateAudioEditorProjectV17 } from '../src/common/editor/project-v17.ts';
import { parseAllegroFile } from '../src/common/editor/allegro-file.ts';
import { midiServiceFixture } from './helpers/midi-service-fixture.ts';

async function imported(file: File) {
	const fixture = midiServiceFixture();
	await createMidiImportFiles({ getProject: fixture.project, importFiles: () => assert.fail('not audio') },
		async () => fixture.service).importFiles([file]);
	assert.ok(validateAudioEditorProjectV17(fixture.project()));
	return fixture;
}
async function exported(fixture: Awaited<ReturnType<typeof imported>>): Promise<string> {
	await fixture.service.exportFile('allegro');
	const text = fixture.saves[0]?.text;
	assert.ok(typeof text === 'string');
	return text;
}

test('Allegro export keeps an initial mode reset before the first sounding note', async () => {
	// A normal SMF clear-then-note sequence, independent of either file writer.
	const track = [0, 0xb0, 123, 0, 0, 0x90, 60, 90, 0x83, 0x60, 0x80, 60, 0, 0, 255, 47, 0];
	const file = new File([Uint8Array.from([77, 84, 104, 100, 0, 0, 0, 6, 0, 0, 0, 1, 1, 224,
		77, 84, 114, 107, 0, 0, 0, track.length, ...track])], 'Initial clear.mid');
	const fixture = await imported(file);
	const clip = fixture.project().clips[0]!;
	assert.ok(fixture.pcm.get(clip.sourceId)![0]!.some(value => Math.abs(value) > 0.02));
	const text = await exported(fixture);
	// Independently verified with Audacity 3.7.7 PortSMF: the reverse order
	// sends CC123 after NoteOn and kills this voice at its onset.
	assert.ok(text.indexOf('-control123r:0') < text.indexOf('K60 P60'), text);
	assert.equal(parseAllegroFile(text, { sampleRate: 8000 }).tracks[0]?.notes[0]?.durationFrames, 4000);
});

test('same-frame Allegro channel setup retains its own update order before new notes', async () => {
	const fixture = await imported(new File(['#track 0 Fader\nT0 -tempor:120\nT0 V0 -control7r:0\nT0 V0 -control7r:1\nT0 V0 P60 U0.5 L90\n'], 'Fader.gro'));
	const text = await exported(fixture);
	assert.ok(text.indexOf('-control7r:0') < text.indexOf('-control7r:1'), text);
	assert.ok(text.indexOf('-control7r:1') < text.indexOf('K60 P60'), text);
	assert.deepEqual(parseAllegroFile(text).tracks[0]?.events?.filter(event => event.status === 176).map(event => event.data), [[7, 0], [7, 127]]);
});

test('Allegro delivery keeps complete SysEx setup messages together and in source order', async () => {
	const fixture = await imported(new File(['#track 0 Synth\nT0 -tempor:120\nT0 V- -sysexs:"f07d01f7"\nT0 V- -sysexs:"f07d02f7"\nT0 V0 -programi:40\nT0 V0 P60 U0.5 L90\n'], 'Synth.gro'));
	const text = await exported(fixture);
	const first = text.indexOf('-sysexs:"f07d01f7"'); const second = text.indexOf('-sysexs:"f07d02f7"');
	assert.ok(first >= 0 && second > first && text.indexOf('-programi:40') > second, text);
	assert.ok(text.indexOf('-programi:40') < text.indexOf('K60 P60'), text);
	assert.deepEqual(parseAllegroFile(text).tracks[0]?.events?.filter(event => event.status === 240).map(event => event.data), [[125, 1, 247], [125, 2, 247]]);
});

test('Allegro controls between note onsets retain their ordinary timing', async () => {
	const fixture = await imported(new File(['#track 0 Later clear\nT0 -tempor:120\nT0 V0 P60 U0.25 L90\nT0.25 V0 -control123r:0\nT0.5 V0 P62 U0.5 L90\n'], 'Later clear.gro'));
	const text = await exported(fixture);
	assert.ok(text.indexOf('K60 P60') < text.indexOf('-control123r:0') && text.indexOf('-control123r:0') < text.indexOf('K62 P62'), text);
	const track = parseAllegroFile(text, { sampleRate: 8000 }).tracks[0]!;
	assert.deepEqual(track.notes.map(note => [note.startFrame, note.durationFrames]), [[0, 2000], [4000, 4000]]);
	assert.equal(track.events?.find(event => event.data[0] === 123)?.frame, 2000);
});
