/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { processedSpectrogramPreparation } from '../src/common/editor/controller/source/internal/processed-spectrogram-pcm.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { createAudioClip, createAudioSource, createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import type { ClipTimePitchCacheEntry } from '../src/common/editor/controller/source/clip-time-pitch-service.ts';
import { spectrogramColumnReuseKey } from '../src/common/editor/ui/timeline/spectrogram-column-reuse.ts';
import type { TimelineWaveformClip } from '../src/common/editor/ui/timeline/waveform-view-model.ts';

function fixture() {
	const source = createAudioSource({ id: 'tone', frameCount: 48_000, channelCount: 1, sampleRate: 48_000 });
	const clip = createAudioClip({ id: 'tone-clip', sourceId: source.id, sourceDurationFrames: source.frameCount,
		durationFrames: 24_000, speedRatio: 2, pitchCents: 1200, reversed: true });
	const project = createSoundscaperProject({ id: 'spectral-processing', sources: [source], clips: [clip], tracks: [createAudioTrack({ id: 'voice', clipIds: [clip.id] })] });
	let current = project;
	let generation = 0;
	let opens = 0, reads = 0, disposals = 0;
	let resolve = (_entry: ClipTimePitchCacheEntry) => {};
	const entry: ClipTimePitchCacheEntry = { cacheKey: 'exact-transformed-revision', sampleRate: 48_000, frameCount: 24_000, cacheSourceId: 'rendered' };
	let held = false;
	const cache = { async prepareCommittedOutput(actualClip: unknown, actualSource: unknown) {
		assert.equal(actualClip, clip); assert.equal(actualSource, source);
		return held ? new Promise<ClipTimePitchCacheEntry>(done => { resolve = done; }) : entry;
	} };
	const prepare = processedSpectrogramPreparation({ getProject: () => current, cache,
		captureAuthority() { const captured = generation; return () => { if (captured !== generation) throw new DOMException('Retired project session', 'AbortError'); }; },
		open(actual) {
			assert.equal(actual, entry); opens++;
			return { frameCount: 24_000, async readWindow(start: number, end: number) {
				reads++; return { startFrame: start, endFrame: end, channels: [new Float32Array(end - start).fill(.25)] };
			}, dispose() { disposals++; } };
		} }, project, clip, source);
	assert.ok(prepare);
	return { project, source, clip, prepare, counts: () => ({ opens, reads, disposals }),
		hold() { held = true; }, finish() { resolve(entry); }, change() { current = createSoundscaperProject({ ...project, title: 'New revision' }); },
		reopenSameObject() { generation++; } };
}

test('spectral preparation reads a committed transformed source without whole-source materialization', async () => {
	const f = fixture(), signal = new AbortController().signal;
	const pcm = await f.prepare(signal);
	assert.equal(pcm.frameCount, 24_000);
	const window = await pcm.readWindow(10_000, 10_128, signal);
	assert.equal(window.channels[0]?.length, 128); assert.equal(window.channels[0]?.[0], .25);
	await pcm.dispose(); assert.deepEqual(f.counts(), { opens: 1, reads: 1, disposals: 1 });
});

for (const changed of ['abort', 'document', 'session'] as const) test(`a retired ${changed} cannot acquire or read processed spectral PCM`, async () => {
	const f = fixture(), abort = new AbortController(); f.hold();
	const pending = f.prepare(abort.signal);
	if (changed === 'abort') abort.abort(); else if (changed === 'document') f.change(); else f.reopenSameObject();
	f.finish(); await assert.rejects(pending, { name: 'AbortError' });
	assert.deepEqual(f.counts(), { opens: 0, reads: 0, disposals: 0 });
});

test('processed PCM rejects late reads after the canonical revision changes and releases its lease', async () => {
	const f = fixture(), signal = new AbortController().signal, pcm = await f.prepare(signal);
	f.change(); await assert.rejects(pcm.readWindow(0, 128, signal), { name: 'AbortError' });
	await pcm.dispose(); assert.deepEqual(f.counts(), { opens: 1, reads: 0, disposals: 1 });
});

test('untransformed and linked-varispeed clips keep their existing source projection', () => {
	const f = fixture();
	const dependencies = { getProject: () => f.project, captureAuthority: () => () => {}, cache: { async prepareCommittedOutput() { throw new Error('No cache is needed'); } },
		open() { throw new Error('No rendered source is needed'); } };
	assert.equal(processedSpectrogramPreparation(dependencies, f.project, { ...f.clip, pitchCents: 0, speedRatio: 1 }, f.source), undefined);
	assert.equal(processedSpectrogramPreparation(dependencies, f.project, { ...f.clip, linkPitchAndTempo: true }, f.source), undefined);
});

test('spectral cache identity follows independent processing without changing waveform geometry', () => {
	const f = fixture();
	const clip: TimelineWaveformClip = { ...f.clip, timelineStartFrame: 0, durationFrames: 24_000,
		waveformStartFrame: 0, waveformEndFrame: 24_000 };
	const key = (changes = {}) => spectrogramColumnReuseKey({ clip: { ...clip, ...changes }, source: f.source,
		width: 100, sampleRate: 48_000, fftWindowSize: 2048, windowType: 'hann', project: f.project });
	for (const changes of [{ pitchCents: 0 }, { preserveFormants: true }, { renderCacheRevision: 10 }, { linkPitchAndTempo: true }]) {
		assert.notEqual(key(changes), key(), JSON.stringify(changes));
	}
});
