/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { applyEditorCommand } from '../src/common/editor/commands.js';
import { createAudioEditorProjectV17 } from '../src/common/editor/project-v17.ts';
import { createMidiService } from '../src/common/editor/controller/track-audio/midi-service.ts';
import type { MidiServiceDependencies } from '../src/common/editor/controller/track-audio/midi-service-types.ts';
import { readMidiClip, readMidiTrack } from '../src/common/editor/midi-model.ts';
import { createAudioEditorFileService } from '../src/common/editor/file-service.js';
import { parseMidiFile } from '../src/common/editor/midi-file.ts';
import type { AudioEditorCommand } from '../src/common/editor/commands/protocol.ts';

function fixture(options: Readonly<Record<string, unknown>> = {}) {
	let project = createAudioEditorProjectV17({ ...options, sampleRate: 8000 });
	let counter = 0;
	const pcm = new Map<string, Float32Array[]>();
	const deleted: string[] = [];
	let onWrite: (() => void) | undefined;
	const saves: Readonly<Record<string, unknown>>[] = [];
	const files = createAudioEditorFileService({ scope: {}, bridge: null, document: null });
	const dependencies: MidiServiceDependencies = {
		getProject: () => project,
		editingBlocked: () => false,
		commit: command => { project = applyEditorCommand(project, command); },
		createId: prefix => {
			let id: string;
			do { id = `${prefix}-${++counter}`; }
			while ([...project.sources, ...project.tracks, ...project.clips].some(record => record.id === id));
			return id;
		},
		trackName: () => 'MIDI track (beta)', clipName: () => 'MIDI clip',
		store: {
			beginSourceWrite: async id => {
				const chunks: Float32Array[] = []; pcm.set(id, chunks);
				return { write: channels => { chunks.push(channels[0]!); onWrite?.(); }, commit: () => undefined, abort: () => undefined };
			},
			deleteSource: async id => { deleted.push(id); pcm.delete(id); },
		},
		previewNote: async () => undefined, saveFile: request => { saves.push(request); return files.saveFile(request); },
	};
	return { service: createMidiService(dependencies), pcm, deleted, saves, project: () => project,
		apply(command: AudioEditorCommand) { project = applyEditorCommand(project, command); },
		replaceProject() { project = createAudioEditorProjectV17({ id: 'replacement', sampleRate: 8000 }); },
		onWrite(callback: () => void) { onWrite = callback; } };
}

test('MIDI track creation and note editing publish matching PCM and MIDI in atomic history revisions', async () => {
	const f = fixture();
	const { trackId, clipId } = await f.service.addTrack();
	assert.equal(readMidiTrack(f.project().tracks[0])?.instrument, 'triangle');
	assert.equal(f.project().revision, 1);
	assert.equal(f.project().tracks[0]?.id, trackId);
	const blank = f.project();
	await f.service.addNote(clipId, { id: 'a', pitch: 60, startFrame: 0, durationFrames: 1000, velocity: 100, channel: 0 });
	assert.equal(f.project().revision, 2);
	assert.equal(readMidiClip(blank.clips[0])?.notes.length, 0);
	assert.equal(readMidiClip(f.project().clips[0])?.notes.length, 1);
	const sourceId = String(f.project().clips[0]?.sourceId);
	assert.ok(f.pcm.get(sourceId)?.some(chunk => chunk.some(value => value !== 0)));
	await f.service.updateNotes(clipId, [{ id: 'a', changes: { pitch: 67, velocity: 45 } }]);
	assert.equal(readMidiClip(f.project().clips[0])?.notes[0]?.pitch, 67);
	await f.service.setInstrument(trackId, 'square');
	assert.equal(readMidiTrack(f.project().tracks[0])?.instrument, 'square');
	await f.service.deleteNotes(clipId, ['a']);
	assert.equal(readMidiClip(f.project().clips[0])?.notes.length, 0);
});

test('MIDI source rendering rejects a project switch and cleans staged storage', async () => {
	const f = fixture();
	f.onWrite(() => f.replaceProject());
	await assert.rejects(f.service.addTrack(), /project changed/iu);
	assert.equal(f.project().tracks.length, 0);
	assert.equal(f.deleted.length, 1);
	assert.equal(f.pcm.size, 0);
});

test('queued MIDI edits merge against the latest document instead of overwriting one another', async () => {
	const f = fixture();
	const { clipId } = await f.service.addTrack();
	await Promise.all([
		f.service.addNote(clipId, { id: 'a', pitch: 60, startFrame: 0, durationFrames: 100, velocity: 100, channel: 0 }),
		f.service.addNote(clipId, { id: 'b', pitch: 64, startFrame: 100, durationFrames: 100, velocity: 100, channel: 0 }),
	]);
	assert.deepEqual(readMidiClip(f.project().clips[0])?.notes.map(note => note.id), ['a', 'b']);
});

test('a new MIDI clip spans four measures using the project signature denominator', async () => {
	const f = fixture({ tempo: { bpm: 120, timeSignature: { numerator: 6, denominator: 8 } } });
	await f.service.addTrack();
	assert.equal(f.project().clips[0]?.durationFrames, 48_000);
});

test('editing a split MIDI clip preserves its boundaries and the neighboring clip', async () => {
	const f = fixture();
	const created = await f.service.importDocument({ sampleRate: 8000, tracks: [{ name: 'Melody', notes: [
		{ id: 'a', pitch: 60, startFrame: 0, durationFrames: 4000, velocity: 100, channel: 0 },
		{ id: 'b', pitch: 64, startFrame: 24000, durationFrames: 8000, velocity: 100, channel: 0 },
	] }], tempos: [{ frame: 0, bpm: 120 }], signatures: [{ frame: 0, numerator: 4, denominator: 4 }] });
	const clipId = created[0]!.clipId;
	f.apply({ type: 'clip/split', clipId, atFrame: 16000, rightClipId: 'right' });
	const right = structuredClone(f.project().clips.find(clip => clip.id === 'right'));
	await f.service.updateNote(clipId, 'a', { pitch: 67 });
	const left = f.project().clips.find(clip => clip.id === clipId)!;
	assert.equal(left.durationFrames, 16000);
	assert.equal(left.sourceDurationFrames, 16000);
	assert.equal(readMidiClip(left)?.notes[0]?.pitch, 67);
	assert.deepEqual(f.project().clips.find(clip => clip.id === 'right'), right);
	await f.service.deleteNotes(clipId, ['a']);
	assert.equal(f.project().clips.find(clip => clip.id === clipId)?.durationFrames, 16000);
});

test('MIDI note geometry edits still extend a clip when its edited note goes beyond the right edge', async () => {
	const f = fixture();
	const { clipId } = await f.service.addTrack();
	await f.service.addNote(clipId, { id: 'a', pitch: 60, startFrame: 0, durationFrames: 4000, velocity: 100, channel: 0 });
	f.apply({ type: 'clip/trim', clipId, durationFrames: 8000, sourceDurationFrames: 8000 });
	await f.service.updateNote(clipId, 'a', { startFrame: 10000 });
	assert.equal(f.project().clips[0]?.durationFrames, 14000);
	assert.equal(f.project().clips[0]?.sourceDurationFrames, 14000);
});

test('MIDI import skips an empty conductor track and adopts initial timing into an empty project', async () => {
	const f = fixture();
	const created = await f.service.importDocument({ sampleRate: 8000,
		tracks: [{ name: 'Conductor', notes: [] }, { name: 'Melody', notes: [
			{ id: 'n', pitch: 60, startFrame: 0, durationFrames: 4000, velocity: 90, channel: 2 },
		] }], tempos: [{ frame: 0, bpm: 90 }], signatures: [{ frame: 0, numerator: 3, denominator: 4 }],
	});
	assert.equal(created.length, 1);
	assert.equal(f.project().tracks.length, 1);
	assert.equal(f.project().tracks[0]?.name, 'Melody');
	assert.equal(readMidiClip(f.project().clips[0])?.notes[0]?.channel, 2);
	const tempo = f.project().tempo as { bpm: number; timeSignature: { numerator: number } };
	assert.equal(tempo.bpm, 90);
	assert.equal(tempo.timeSignature.numerator, 3);
});

test('imported All Notes Off releases keys while the sustain pedal keeps their PCM sounding', async () => {
	const f = fixture();
	// Type 0, 480 PPQN: pedal down, A4 on, All Notes Off at 1 s,
	// pedal up at 1.5 s, and the authored note-off at 2 s.
	const bytes = Uint8Array.from(Buffer.from(
		'4d546864000000060000000101e04d54726b0000001b00b0407f009045648740b07b008360b04000836080450000ff2f00', 'hex'));
	await f.service.importDocument(parseMidiFile(bytes, { sampleRate: 8000 }));
	const sourceId = String(f.project().clips[0]?.sourceId);
	const samples = f.pcm.get(sourceId)![0]!;
	assert.ok(samples.slice(8500, 11000).some(value => Math.abs(value) > 0.01), 'pedal-held notes must survive All Notes Off');
	assert.ok(samples.slice(12000).every(value => value === 0), 'pedal-up must release keys already stopped by All Notes Off');
	assert.equal(readMidiClip(f.project().clips[0])?.notes[0]?.durationFrames, 8000);
});

test('type-1 MIDI channel controls on a separate track affect the imported note PCM', async () => {
	const f = fixture();
	// Controller track mutes channel 1 until 0.5 s; the other track holds A4 for 1 s.
	const bytes = Uint8Array.from(Buffer.from(
		'4d546864000000060001000201e04d54726b0000000d00b007008360b0077f00ff2f004d54726b0000000d00904564874080450000ff2f00', 'hex'));
	await f.service.importDocument(parseMidiFile(bytes, { sampleRate: 8000 }));
	const clip = f.project().clips.find(candidate => readMidiClip(candidate)?.notes.length)!;
	const assertVolume = (samples: Float32Array) => {
		assert.ok(samples.slice(1000, 3000).every(value => value === 0), 'channel-volume controls belong to the shared MIDI channel');
		assert.ok(samples.slice(5000, 7000).some(value => Math.abs(value) > 0.01));
	};
	assertVolume(f.pcm.get(String(clip.sourceId))![0]!);
	assert.equal(f.project().tracks.length, 1);
	assert.equal(f.project().tracks[0]?.name, 'MIDI 2');
	const expectedEvents = [{ frame: 0, status: 0xb0, data: [7, 0] }, { frame: 4000, status: 0xb0, data: [7, 127] }];
	assert.deepEqual(readMidiClip(clip)?.interchange?.events, expectedEvents);
	const noteId = readMidiClip(clip)!.notes[0]!.id;
	await f.service.updateNote(String(clip.id), noteId, { pitch: 67 });
	assertVolume(f.pcm.get(String(f.project().clips[0]?.sourceId))![0]!);
	const reopened = fixture(structuredClone(f.project()));
	await reopened.service.setInstrument(String(reopened.project().tracks[0]?.id), 'square');
	assertVolume(reopened.pcm.get(String(reopened.project().clips[0]?.sourceId))![0]!);
	assert.deepEqual(readMidiClip(reopened.project().clips[0])?.interchange?.events, expectedEvents);
	await reopened.service.exportFile('midi');
	const exported = parseMidiFile(reopened.saves[0]!.bytes as Uint8Array, { sampleRate: 8000 });
	assert.deepEqual(exported.tracks.flatMap(track => track.events ?? []), expectedEvents);
});

test('both MIDI exports use the real shared file service interchange save contract', async () => {
	const f = fixture();
	const { clipId } = await f.service.addTrack();
	await f.service.addNote(clipId, { id: 'n', pitch: 60, startFrame: 0, durationFrames: 4000, velocity: 90, channel: 0 });
	for (const format of ['midi', 'allegro'] as const) {
		const result = await f.service.exportFile(format) as { method: string; size: number };
		assert.equal(result.method, 'blob');
		assert.ok(result.size > 20);
		assert.equal(f.saves.at(-1)?.purpose, 'interchange');
		assert.ok(String(f.saves.at(-1)?.suggestedName).endsWith(format === 'midi' ? '.mid' : '.gro'));
	}
});
