/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createStreamedEffectService } from '../src/common/editor/controller/effects/internal/streamed/streamed-effect-service.ts';
import { runStreamedSelectionProcessing } from '../src/common/editor/streamed-effects/processing.ts';
import type { EffectTarget } from '../src/common/editor/controller/effects/effect-selection-service.ts';
import type { StreamedEffectStep } from '../src/common/editor/streamed-effects/admission.ts';
import type { AudioEditorCommand } from '../src/common/editor/commands/protocol.ts';

function fixture(options: { source?: boolean; clips?: boolean; failWrite?: number; cancel?: boolean; failRelease?: boolean; selectedTrackId?: string } = {}) {
	const length = 140003, frames = options.source ? length + 41 : length;
	const original = Float32Array.from({ length: frames }, (_, f) => .1 + Math.sin(f * .03) * .2);
	const sources = new Map<string, Float32Array[]>(), writes = new Map<string, number[]>(), deleted: string[] = [], activated: string[] = [], publications: AudioEditorCommand[] = [];
	const focus: { trackId: string; clipId?: string }[] = [];
	let id = 0, writeCount = 0, stale = false, maximumRead = 0;
	const target: EffectTarget = { track: { id: 'track', name: 'Track', type: 'audio' }, startFrame: options.source ? 17 : 0,
		endFrame: options.source ? length + 17 : length, durationFrames: length, channelCount: 1, hasAudio: true,
		...(options.source ? { sourceId: 'original', sourceFrameCount: frames, sourceClipId: 'clip', sourceTrackId: 'real-track', sourceSampleRate: 48000 } : {}),
		...(options.clips ? { clipId: 'clip' } : {}) };
	const service = createStreamedEffectService({ chunkFrames: 65536, memoryLimitBytes: 256 * 1024 ** 2,
		getProject: () => ({ id: 'project', sources: [], clips: [], tracks: [] }), createId: () => `processed-${++id}`,
		getSelectedTrackId: () => options.selectedTrackId ?? null,
		read: async (_track, start, end) => { maximumRead = Math.max(maximumRead, end - start); return [original.slice(start, end)]; },
		readStored: async (source, start, end) => {
			const output = new Float32Array(end - start); let offset = 0;
			for (const chunk of sources.get(source.id) ?? []) { const from = Math.max(start, offset), to = Math.min(end, offset + chunk.length); if (to > from) output.set(chunk.subarray(from - offset, to - offset), from - start); offset += chunk.length; }
			return [output];
		},
		process: async (request, ports) => runStreamedSelectionProcessing(request, ports),
		store: { beginSourceWrite: async sourceId => { sources.set(sourceId, []); writes.set(sourceId, []); return {
			write: async channels => { if (++writeCount === options.failWrite) throw new Error('write failed'); sources.get(sourceId)!.push(channels[0]!.slice()); writes.get(sourceId)!.push(channels[0]!.length); if (options.cancel) stale = true; },
			commit: async () => undefined, abort: async () => { deleted.push(sourceId); sources.delete(sourceId); },
		}; }, saveAnalysis: async () => undefined, deleteAnalysis: async () => undefined,
			deleteSource: async sourceId => { deleted.push(sourceId); sources.delete(sourceId); } },
		activateSource: async source => { activated.push(source.id); }, releaseSource: async () => { if (options.failRelease) throw new Error('cache release failed'); },
		prepareReplacement: (t, source) => ({ type: 'range/replace', trackId: t.track.id, startFrame: t.startFrame, endFrame: t.endFrame, source, clipId: 'replacement', splitClipIds: {} }),
		publish: (command, trackId, clipId) => { publications.push(command); focus.push({ trackId, clipId }); },
	});
	const run = (effects: readonly StreamedEffectStep[] = [{ type: 'audacity-normalize', params: { removeDc: false, peakDb: -3 } }], targets = 1) => service(Array.from({ length: targets }, (_, index) => ({ target: { ...target, track: { ...target.track, id: `track-${index}` } }, effects })),
		{ sampleRate: 48000, effectName: 'Effect', selectionDetails: {}, signal: new AbortController().signal,
			assertCurrent: () => { if (stale) throw new Error('cancelled'); } });
	return { run, original, target, sources, writes, deleted, activated, publications, focus, maximumRead: () => maximumRead };
}
for (const mode of ['range', 'source', 'clips'] as const) test(`streamed ${mode} application publishes one edit and keeps regular bounded storage packets`, async () => {
	const f = fixture({ source: mode === 'source', clips: mode === 'clips' }); await f.run();
	assert.equal(f.publications.length, 1); assert.equal(f.activated.length, 1); assert.ok(f.maximumRead() <= 65536);
	const chunks = f.sources.get(f.activated[0]!)!;
	const output = Float32Array.from(chunks.flatMap(chunk => [...chunk]));
	assert.equal(output.length, f.original.length);
	if (mode === 'source') { assert.deepEqual(output.slice(0, 17), f.original.slice(0, 17)); assert.deepEqual(output.slice(f.target.endFrame), f.original.slice(f.target.endFrame)); }
	const command = f.publications[0]! as { type: string; commands: Array<{ type: string }> };
	assert.equal(command.commands[0]!.type, mode === 'source' ? 'source/process-audio' : mode === 'clips' ? 'clip/render-replace-many' : 'range/replace');
	assert.ok([...f.writes.values()].every(sizes => sizes.slice(0, -1).every(size => size === 65536)));
});
test('mixed normalization and causal segments stage bounded intermediate media and remove it before one publication', async () => {
	const f = fixture();
	await f.run([{ type: 'audacity-invert', params: {} }, { type: 'audacity-normalize', params: { removeDc: false, peakDb: -3 } }, { type: 'audacity-invert', params: {} }]);
	assert.equal(f.sources.size, 1); assert.equal(f.deleted.length, 2); assert.equal(f.publications.length, 1);
});
test('streamed multitrack Apply keeps the focused selected track', async () => {
	const f = fixture({ selectedTrackId: 'track-1' });
	await f.run(undefined, 2);
	assert.deepEqual(f.focus, [{ trackId: 'track-1', clipId: undefined }]);
});
for (const options of [{ failWrite: 4 }, { cancel: true }, { failWrite: 4, failRelease: true }]) test('failed or cancelled multi-target streams remove staged results without publishing', async () => {
	const f = fixture(options); await assert.rejects(f.run(undefined, 2)); assert.deepEqual(f.publications, []); assert.equal(f.sources.size, 0);
});
