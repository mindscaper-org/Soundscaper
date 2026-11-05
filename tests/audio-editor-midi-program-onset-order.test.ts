/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createMidiImportFiles } from '../src/common/editor/controller/composition/internal/midi-import-files.ts';
import { parseMidiFile, writeMidiFile } from '../src/common/editor/midi-file.ts';
import { assertMidiFileProgramOrder } from '../src/common/editor/midi-file-destinations.ts';
import { midiServiceFixture } from './helpers/midi-service-fixture.ts';

const programOrder = /program.*(order|onset|assignment)/iu;
const on = [0, 144, 60, 100], off = [0x83, 0x60, 128, 60, 0];
const pc = (program: number, channel = 0): number[] => [0, 192 | channel, program];
const port = (value: number): number[] => [0, 255, 33, 1, value];
function smf(...tracks: readonly (readonly number[])[]): Uint8Array<ArrayBuffer> {
	const bytes = [77, 84, 104, 100, 0, 0, 0, 6, 0, tracks.length === 1 ? 0 : 1, 0, tracks.length, 1, 224];
	for (const track of tracks) {
		const body = [...track, 0, 255, 47, 0];
		bytes.push(77, 84, 114, 107, body.length >>> 24, body.length >>> 16 & 255, body.length >>> 8 & 255, body.length & 255, ...body);
	}
	return Uint8Array.from(bytes);
}
function roundtrip(...tracks: readonly (readonly number[])[]): void {
	const document = parseMidiFile(smf(...tracks), { sampleRate: 8000 });
	assert.equal(document.tracks.flatMap(track => track.notes).length, 1);
	assert.doesNotThrow(() => parseMidiFile(writeMidiFile(document), { sampleRate: 8000 }));
}

test('same-tick late Program Change refuses the demonstrated changed onset assignment', () => {
	assert.throws(() => parseMidiFile(smf([...pc(5), ...on, ...pc(10), ...off])), programOrder);
});

test('an unknown initial patch cannot silently acquire a later same-tick program', () => {
	assert.throws(() => parseMidiFile(smf([...on, ...pc(10), ...off])), programOrder);
});

test('public FileImport refuses before publishing a clip or saving a changed program stream', async () => {
	const fixture = midiServiceFixture();
	const importer = createMidiImportFiles({ getProject: fixture.project, importFiles: () => assert.fail('MIDI import') }, async () => fixture.service);
	await assert.rejects(importer.importFiles([new File([smf([...pc(5), ...on, ...pc(10), ...off])], 'Late patch.mid')]), programOrder);
	assert.equal(fixture.project().clips.length, 0);
	assert.equal(fixture.saves.length, 0);
});

test('canceled FileImport retains its AbortError before program-order diagnostics', async () => {
	const fixture = midiServiceFixture(), cancellation = new AbortController(); cancellation.abort();
	const importer = createMidiImportFiles({ getProject: fixture.project, importFiles: () => assert.fail('MIDI import') }, async () => fixture.service);
	await assert.rejects(importer.importFiles([new File([smf([...pc(5), ...on, ...pc(10), ...off])], 'Late patch.mid')], { signal: cancellation.signal }), { name: 'AbortError' });
	assert.equal(fixture.project().clips.length, 0);
});

test('files without Program Change never prepare or sort another clock', () => {
	assertMidiFileProgramOrder([{ events: [{ tick: 0, status: 144, data: [60, 100] }] }],
		() => assert.fail('unneeded point conversion'), new Map(), () => assert.fail('unneeded writer clock'));
});

test('a repeated same-program message after an onset is harmless', () => roundtrip([...pc(5), ...on, ...pc(5), ...off]));
test('ordinary multiple setup programs before the onset remain admitted', () => roundtrip([...pc(5), ...pc(10), ...on, ...off]));
test('a late changed program restored before a new onset preserves its original patch', () => roundtrip([...pc(5), ...on, ...pc(10), ...pc(5), ...off]));
test('a program change at a later tick remains admitted', () => roundtrip([...pc(5), ...on, 120, 192, 10, ...off]));
test('another channel does not change the onset patch', () => roundtrip([...pc(5), ...on, ...pc(10, 1), ...off]));
test('another MIDI port does not change the onset patch', () => roundtrip([...pc(5), ...on, ...port(1), ...pc(10), ...port(0), ...off]));
for (const controller of [0, 32]) {
	test(`a repeated program under changed bank selector ${String(controller)} is a changed onset patch`, () => {
		assert.throws(() => parseMidiFile(smf([0, 176, controller, 1, ...pc(5), ...on, 0, 176, controller, 2, ...pc(5), ...off])), programOrder);
	});
	test(`a repeated program under unchanged bank selector ${String(controller)} is harmless`, () => roundtrip(
		[0, 176, controller, 1, ...pc(5), ...on, 0, 176, controller, 1, ...pc(5), ...off],
	));
}
test('a pending changed bank without another Program Change leaves the active onset patch alone', () => roundtrip(
	[0, 176, 0, 1, ...pc(5), ...on, 0, 176, 0, 2, ...off],
));
test('a complete bank MSB/LSB and program repeat preserves the active patch', () => roundtrip(
	[0, 176, 0, 1, 0, 176, 32, 2, ...pc(5), ...on, 0, 176, 0, 1, 0, 176, 32, 2, ...pc(5), ...off],
));
test('another channel bank and repeated program do not change the onset patch', () => roundtrip(
	[0, 176, 0, 1, ...pc(5), ...on, 0, 177, 0, 2, ...pc(5, 1), ...off],
));
test('another port bank and repeated program do not change the onset patch', () => roundtrip(
	[0, 176, 0, 1, ...pc(5), ...on, ...port(1), 0, 176, 0, 2, ...pc(5), ...port(0), ...off],
));
test('another trackwide device does not change the onset patch', () => roundtrip(
	[0, 255, 9, 1, 65, ...pc(5), ...on, ...off], [0, 255, 9, 1, 66, ...pc(10)],
));

test('synchronous tracks retain their track merge order when a later track changes the patch', () => roundtrip([...pc(5), ...on, ...off], pc(10)));
test('a setup on another synchronous track supplies the actual known onset patch', () => roundtrip(pc(5), [...on, ...pc(5), ...off]));
test('a changed late local program compares against setup on another synchronous track', () => {
	assert.throws(() => parseMidiFile(smf(pc(5), [...on, ...pc(10), ...off])), programOrder);
});

test('events merged by source sample rounding cannot change an earlier onset patch', () => {
	const input = smf([...pc(5), ...on, 1, 192, 10, ...off]);
	input[12] = 127; input[13] = 255;
	assert.throws(() => parseMidiFile(input, { sampleRate: 8000 }), programOrder);
});

test('fixed export PPQ cannot hoist a distinct source frame program across its onset', () => {
	const input = smf([...pc(5), ...on, 1, 192, 10, ...off]);
	input[12] = 127; input[13] = 255;
	assert.throws(() => parseMidiFile(input, { sampleRate: 48000 }), programOrder);
});

for (const bpm of [120, 20]) test(`project tempo ${String(bpm)} keeps MIDI export faithful or refuses before Save`, async () => {
	const input = smf([...pc(5), ...on, 1, 192, 10, ...off]); input[12] = 18; input[13] = 192;
	const fixture = midiServiceFixture({ sampleRate: 48000 });
	const importer = createMidiImportFiles({ getProject: fixture.project, importFiles: () => assert.fail('MIDI import') }, async () => fixture.service);
	await importer.importFiles([new File([input], 'Retained patch chronology.mid')]);
	fixture.apply({ type: 'tempo/set', bpm });
	if (bpm === 20) {
		await assert.rejects(fixture.service.exportFile('midi'), programOrder);
		assert.equal(fixture.saves.length, 0);
	} else {
		await fixture.service.exportFile('midi'); const bytes = fixture.saves[0]?.bytes; assert.ok(bytes instanceof Uint8Array);
		const reopened = parseMidiFile(bytes, { sampleRate: 48000 });
		assert.equal(reopened.tracks.flatMap(track => track.notes).length, 1);
	}
});

test('project tempo quantization cannot move an earlier track program across a later track onset', async () => {
	const input = smf([...pc(5), 1, 192, 10], [...on, ...off]); input[12] = 18; input[13] = 192;
	const fixture = midiServiceFixture({ sampleRate: 48000 }); await fixture.service.importDocument(parseMidiFile(input, { sampleRate: 48000 }));
	fixture.apply({ type: 'tempo/set', bpm: 20 });
	await assert.rejects(fixture.service.exportFile('midi'), programOrder);
	assert.equal(fixture.saves.length, 0);
});

test('same-program messages remain harmless after project tempo tick quantization', async () => {
	const input = smf([...pc(5), ...on, 1, 192, 5, ...off]); input[12] = 18; input[13] = 192;
	const fixture = midiServiceFixture({ sampleRate: 48000 }); await fixture.service.importDocument(parseMidiFile(input, { sampleRate: 48000 }));
	fixture.apply({ type: 'tempo/set', bpm: 20 }); await fixture.service.exportFile('midi');
	const bytes = fixture.saves[0]?.bytes; assert.ok(bytes instanceof Uint8Array);
	assert.equal(parseMidiFile(bytes).tracks.flatMap(track => track.notes).length, 1);
});

for (const mode of [120, 123]) {
	test(`causal mode ${String(mode)} keeps a later program after its stopped onset`, () => roundtrip([...pc(5), ...on, 0, 176, mode, 0, ...pc(10), ...off]));
	test(`causal mode ${String(mode)} cannot move an earlier late program before the onset`, () => {
		assert.throws(() => parseMidiFile(smf([...pc(5), ...on, ...pc(10), 0, 176, mode, 0, ...off])), programOrder);
	});
}
