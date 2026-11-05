/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createMidiImportFiles } from '../src/common/editor/controller/composition/internal/midi-import-files.ts';
import { parseAllegroFile } from '../src/common/editor/allegro-file.ts';
import { parseMidiFile, writeMidiFile } from '../src/common/editor/midi-file.ts';
import { readMidiClip } from '../src/common/editor/midi-model.ts';
import { validateAudioEditorProjectV17 } from '../src/common/editor/project-v17.ts';
import { midiServiceFixture } from './helpers/midi-service-fixture.ts';

const note = 'T0 V2 K60 P60 U0.5 L90\n';

for (const scope of ['V2 ', '']) test(`Allegro refuses ${scope || 'implicit V0 '}lyrics before losing native channel association`, async () => {
	const fixture = midiServiceFixture(); const before = fixture.project();
	await assert.rejects(imported(fixture, new File([`#track 0 Lyrics\nT0 -tempor:120\nT0 ${scope}-lyrics:"hello"\n${note}`], 'Channel lyrics.gro')),
		/channel.scoped.*text|text.*channel/iu);
	assert.equal(fixture.project(), before); assert.equal(fixture.pcm.size, 0); assert.equal(fixture.saves.length, 0);
});

test('every supported native scoped text field refuses the same unrepresentable association', () => {
	for (const field of ['texts', 'copyrights', 'seqnames', 'tracknames', 'instruments', 'markers', 'cues', 'miscs']) {
		assert.throws(() => parseAllegroFile(`T0 V2 -${field}:"text"\n${note}`), /channel.scoped.*text|text.*channel/iu, field);
	}
});

test('scoped text followed by V- text never acquires a guessed prefix reset', async () => {
	const fixture = midiServiceFixture();
	await assert.rejects(imported(fixture, new File([`T0 V2 -lyrics:"voice"\nT0 V- -texts:"global"\n${note}`], 'Scopes.gro')),
		/channel.scoped.*text|text.*channel/iu);
	assert.equal(fixture.pcm.size, 0);
});

test('global text, channel controls and ordinary notes remain supported through MIDI delivery', async () => {
	const fixture = midiServiceFixture();
	await imported(fixture, new File([`T0 -tempor:120\nT0 V2 -control7r:0.5\nT0 V- -lyrics:"hello"\n${note}`], 'Global lyrics.gro'));
	assert.ok(validateAudioEditorProjectV17(JSON.parse(JSON.stringify(fixture.project()))));
	assert.equal(readMidiClip(fixture.project().clips[0])?.notes[0]?.channel, 2);
	await fixture.service.exportFile('midi');
	const bytes = fixture.saves[0]?.bytes; assert.ok(bytes instanceof Uint8Array);
	const events = parseMidiFile(bytes).tracks.flatMap(track => track.events ?? []);
	assert.ok(events.some(event => event.status === 178 && event.data[0] === 7));
	assert.ok(events.some(event => event.metaType === 5 && new TextDecoder().decode(Uint8Array.from(event.data)) === 'hello'));
	assert.ok(!events.some(event => event.metaType === 32));
});

test('ordinary raw MIDI channel prefixes remain retained through file import and delivery', async () => {
	const fixture = midiServiceFixture();
	const bytes = writeMidiFile({ sampleRate: 8000, tempos: [], signatures: [], tracks: [{ name: 'Scoped lyrics',
		notes: [{ id: 'n', pitch: 60, channel: 2, startFrame: 0, durationFrames: 4000, velocity: 90 }],
		events: [{ frame: 0, status: 255, metaType: 32, data: [2] }, { frame: 0, status: 255, metaType: 5, data: [...new TextEncoder().encode('hello')] }] }] });
	await imported(fixture, new File([bytes], 'Scoped lyrics.mid'));
	await fixture.service.exportFile('midi');
	const delivered = fixture.saves[0]?.bytes; assert.ok(delivered instanceof Uint8Array);
	assert.deepEqual(parseMidiFile(delivered).tracks.flatMap(track => track.events ?? []).filter(event => event.metaType === 32).map(event => event.data), [[2]]);
});

test('native SysEx, sequencer-specific and key-signature conversion keeps its existing channel policy', () => {
	const parsed = parseAllegroFile(`T0 -tempor:120\nT0 V2 -sysexs:"f07d01f7"\nT0 V2 -sqspecifics:"01ab"\nT0 -keysigi:1 -modea:'major'\n${note}`);
	assert.ok(parsed.tracks[0]?.events?.some(event => event.status === 240));
	assert.ok(parsed.tracks[0]?.events?.some(event => event.metaType === 127));
	assert.ok(parsed.tracks[0]?.events?.some(event => event.metaType === 89));
});

async function imported(fixture: ReturnType<typeof midiServiceFixture>, file: File) {
	return createMidiImportFiles({ getProject: fixture.project, importFiles: () => assert.fail('MIDI import must own these files') },
		async () => fixture.service).importFiles([file]);
}
