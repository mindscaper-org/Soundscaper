/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createSoundscaperVampAnalyzerSession } from '../src/common/editor/ui/workspace/soundscaper-vamp-analyzer-runtime.ts';
import { midiServiceFixture } from './helpers/midi-service-fixture.ts';
import { readMidiClip, readMidiTrack } from '../src/common/editor/midi-model.ts';
import type { VampAnalysisRequest, VampAnalysisResult } from '../src/common/editor/vamp-analysis.ts';

const output = { id: 'notes', name: 'Notes', description: '', unit: 'Hz',
	sampleType: 'variable-sample-rate' as const, sampleRate: null, hasDuration: true };
const analyzer = { analyzerId: 'pyin', stableId: 'pyin', binarySha256: 'ab'.repeat(32),
	name: 'pYIN', maker: 'QMUL', programs: [], parameters: [], outputs: [output] };
const request: VampAnalysisRequest = { schemaVersion: 1, analyzerId: 'pyin', stableId: 'pyin',
	binarySha256: analyzer.binarySha256, outputId: 'notes', program: null, parameters: [], scope: 'master',
	startFrame: 4_000, endFrame: 12_000, sampleRate: 8_000 };
const result: VampAnalysisResult = { schemaVersion: 1, request, features: [{
	timestamp: { seconds: 0, nanoseconds: 250_000_000 }, duration: { seconds: 0, nanoseconds: 500_000_000 }, values: [440], label: '',
}] };

function fixture() {
	const f = midiServiceFixture();
	let stale = false;
	const controller = { get project() {
		return { ...f.project(), revision: stale ? 99 : f.project().revision,
			selection: { startFrame: 4_000, endFrame: 12_000 } };
	}, actions: { edit: { commit: () => { throw new Error('Use the MIDI source publisher.'); } }, midi: f.service } };
	const session = createSoundscaperVampAnalyzerSession({ controller, durationFrames: 16_000,
		port: { list: async () => [analyzer], analyze: async () => result } });
	assert.ok(session);
	return { f, session, retire: () => { stale = true; } };
}

test('Vamp MIDI publication creates an editable, playable track at the original selection position', async () => {
	const { f, session } = fixture();
	assert.equal(session.midiAvailable, true);
	await session.publishMidi(result, 'Hummed melody');
	const project = f.project();
	const track = project.tracks.find(track => readMidiTrack(track));
	const clip = project.clips.find(clip => readMidiClip(clip));
	assert.ok(track);
	assert.ok(clip);
	assert.equal(track.name, 'Hummed melody');
	assert.equal(clip.timelineStartFrame, 4_000);
	assert.equal(clip.durationFrames, 8_000);
	assert.equal(readMidiClip(clip)!.notes[0]!.startFrame, 2_000);
	assert.equal(readMidiClip(clip)!.notes[0]!.pitch, 69);
	assert.ok(f.pcm.size > 0, 'the existing MIDI service retains playable source audio');
});

test('cancelled, stale and mismatched Vamp results publish neither MIDI nor sources', async () => {
	const { f, session, retire } = fixture();
	const cancelled = new AbortController(); cancelled.abort();
	await assert.rejects(() => session.publishMidi(result, 'Cancelled', cancelled.signal), { name: 'AbortError' });
	await assert.rejects(() => session.publishMidi({ ...result, request: { ...request, binarySha256: 'cd'.repeat(32) } }, 'Unknown'), /no longer available/iu);
	retire();
	await assert.rejects(() => session.publishMidi(result, 'Stale'), /project changed/iu);
	assert.equal(f.project().clips.length, 0);
	assert.equal(f.pcm.size, 0);
});
