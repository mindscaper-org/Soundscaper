import assert from 'node:assert/strict';
import test from 'node:test';

import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { projectForRuntimeConsumers } from '../src/common/editor/project-current-runtime.ts';
import { createExportPlan } from '../src/common/editor/export.js';

test('individual clip delivery prepares one isolated project per output across all admission phases', () => {
	const count = 50;
	const project = createSoundscaperProject({ id: 'clip-plan-work',
		sources: [{ id: 'source', storageKey: 'source', frameCount: 64, channelCount: 1, sampleRate: 48_000 }],
		tracks: [{ id: 'audio', clipIds: Array.from({ length: count }, (_, index) => `clip-${index}`) }],
		clips: Array.from({ length: count }, (_, index) => ({ id: `clip-${index}`, sourceId: 'source',
			timelineStartFrame: index * 64, sourceStartFrame: 0, sourceDurationFrames: 64, durationFrames: 64 })) });
	const runtime = projectForRuntimeConsumers(project);
	let inventoryPasses = 0, clipVisits = 0;
	const original = Array.prototype.filter;
	Array.prototype.filter = function<T>(this: T[], predicate: (value: T, index: number, array: T[]) => unknown, receiver?: unknown): T[] {
		if (this !== runtime.clips) return original.call(this, predicate, receiver) as T[];
		inventoryPasses++;
		return original.call(this, (value: T, index: number, array: T[]) => { clipVisits++; return predicate.call(receiver, value, index, array); }) as T[];
	};
	try {
		const plan = createExportPlan(runtime, { mode: 'clips', format: 'wav', includeTail: false });
		assert.equal(plan.outputs.length, count);
		assert.equal(plan.render.strategy, 'offline');
		assert.deepEqual(plan.outputs.map(output => output.clipId), project.clips.map(clip => clip.id));
		// One initial clip-boundary pass, followed by one isolation per output.
		assert.equal(inventoryPasses, count + 1);
		assert.equal(clipVisits, count * (count + 1));
	} finally { Array.prototype.filter = original; }
});
