/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createSoundscaperProject, validateSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { prepareManagedAudioConsolidation, type ConsolidateManagedAudioStore } from '../src/common/editor/controller/document/internal/native-project/consolidate-managed-audio.ts';
import { createConsolidatePlan } from '../src/common/editor/consolidate-plan.ts';
import type { StorageRecord } from '../src/common/editor/storage/media-records.ts';

function projectFixture(count: number) {
	const project = createSoundscaperProject({ id: 'consolidation-work',
		sources: Array.from({ length: count }, (_, index) => ({ id: `s${index}`, storageKey: `s${index}`,
			sampleRate: 48_000, channelCount: 1, frameCount: 64 })),
		clips: Array.from({ length: count }, (_, index) => ({ id: `c${index}`, sourceId: `s${index}`,
			sourceStartFrame: 0, sourceDurationFrames: 64, durationFrames: 64, timelineStartFrame: index * 64 })),
		tracks: [{ id: 'track', clipIds: Array.from({ length: count }, (_, index) => `c${index}`) }],
	});
	assert.ok(validateSoundscaperProject(project));
	return project;
}

test('managed consolidation groups clip bindings once while retaining exact PCM verification and generation fences', async () => {
	const count = 300;
	const project = projectFixture(count);
	let references = 0;
	const measured = { ...project, clips: project.clips.map(clip => ({ ...clip,
		get sourceId() { references++; return clip.sourceId; },
	})) };
	const metadata = new Map<string, StorageRecord>();
	const pcm = new Map<string, readonly Float32Array[]>();
	for (const source of project.sources) {
		assert.ok(source.kind === 'audio');
		metadata.set(source.id, { ...source, storage: 'indexeddb', sourceToken: `token-${source.id}`,
			chunkCount: 1, chunkFrames: 64, rawChunkCount: 1 });
		pcm.set(source.id, [new Float32Array(64).fill(Number(source.id.slice(1)) / count)]);
	}
	let releases = 0;
	const store: ConsolidateManagedAudioStore = {
		getSourceMetadata: async id => metadata.get(id),
		openSourceReadSession: async id => ({ chunk: async () => ({ index: 0, frames: 64, channels: pcm.get(id)! }),
			release: async () => { releases++; } }),
		beginSourceWrite: async (id, options) => {
			assert.equal(options.pcmEncodingPolicy, 'wavpack-required');
			let channels: readonly Float32Array[] = [];
			return { write: async input => { channels = input.map(channel => channel.slice()); },
				commit: async () => {
					const record = { id, storage: 'indexeddb', sourceToken: `token-${id}`, chunkCount: 1, chunkFrames: 64,
						frameCount: 64, sampleRate: 48_000, channelCount: 1, rawChunkCount: 0, wavpackChunkCount: 1 };
					metadata.set(id, record); pcm.set(id, channels); return record;
				}, abort: async () => undefined };
		}, discardSourceIfCurrent: async () => true,
	};
	const prepared = await prepareManagedAudioConsolidation(measured, store, () => {});
	assert.equal(prepared.commands.length, count);
	for (const [index, command] of prepared.commands.entries()) {
		assert.equal(command.type, 'source/rewrite-media');
		assert.equal(command.sourceId, `s${index}`);
		assert.deepEqual(command.clips, [{ clipId: `c${index}`, sourceStartFrame: 0 }]);
	}
	assert.equal(releases, count * 2);
	assert.ok(references <= count * 2, `received ${references} clip binding reads`);
});

test('linked consolidation planning uses keyed source-plan membership for an admitted inventory', () => {
	const count = 500;
	const project = projectFixture(count);
	const bindings = project.sources.map(source => ({ sourceId: source.id, storageKey: source.storageKey,
		byteLength: 256, sha256: 'ab'.repeat(32), bindingToken: `token-${source.id}`, kind: 'audio' as const }));
	const original = Array.prototype.some;
	let visits = 0;
	Object.defineProperty(Array.prototype, 'some', { configurable: true, writable: true,
		value(this: unknown[], callback: (value: unknown, index: number, values: unknown[]) => unknown, receiver?: unknown) {
			const first = this[0] as { sourceId?: unknown; bindingToken?: unknown } | undefined;
			if (typeof first?.sourceId !== 'string' || !('bindingToken' in first)) return original.call(this, callback, receiver);
			return original.call(this, (value, index, values) => { visits++; return callback.call(receiver, value, index, values); });
		} });
	try {
		const plan = createConsolidatePlan({ project, bindings });
		assert.equal(plan.copy.length, count);
		assert.equal(plan.copyByteLength, count * 256);
		assert.equal(plan.complete, true);
		assert.ok(visits <= count * 2, `received ${visits} source-plan membership probes`);
	} finally { Object.defineProperty(Array.prototype, 'some', { configurable: true, writable: true, value: original }); }
});
