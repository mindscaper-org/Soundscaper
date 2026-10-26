/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { compileParallelStackPlan } from '../src/common/editor/engine/parallel-stack-plan.ts';
import type { ParallelStackPlan } from '../src/common/editor/engine/parallel-stack-types.ts';
import { parallelPlanningFixture } from './helpers/responsiveness-round4-parallel-fixtures.ts';

interface FrozenCase { seed: number; sampleRate: number; sha256: string; outcome: string; }
const receipt = JSON.parse(readFileSync(new URL('./fixtures/responsiveness-round4-parallel-parity.json', import.meta.url), 'utf8')) as {
	baselineSourceRevision: string; hashes: FrozenCase[];
};

/** E4-013 adds one Float64 peak and Uint32 slot per lookahead frame, including t0.
 * Verify that exact new allocation, then retain the original complete-plan oracle.
 * No scheduling, routing, processor controls or refusal hashes are regenerated.
 */
function withoutReviewedLimiterAllocation(plan: ParallelStackPlan): ParallelStackPlan {
	let addedBytes = 0;
	const tasks = plan.tasks.map(task => ({ ...task, effects: task.effects.map(effect => {
		if (effect.type !== 'limiter') return effect;
		const lookaheadFrames = Math.ceil(Number(effect.params.lookahead ?? 0) * plan.sampleRate);
		assert.equal(effect.latencyFrames, lookaheadFrames);
		const queueBytes = (lookaheadFrames + 1) * 12;
		const previousBytes = 65_536 + task.channels * 4096 + (lookaheadFrames + 1) * task.channels * 4;
		assert.equal(effect.stateBytes, previousBytes + queueBytes, 'charge both bounded peak-window arrays exactly once');
		addedBytes += queueBytes;
		return { ...effect, stateBytes: previousBytes };
	}) }));
	return { ...plan, tasks, memoryBytes: plan.memoryBytes - addedBytes };
}

test('144 frozen parallel plans and refusals retain every field except reviewed limiter queue allocation', () => {
	for (const { seed, sampleRate, sha256 } of receipt.hashes) {
		let value: unknown;
		let plan: ParallelStackPlan | null = null;
		try { plan = compileParallelStackPlan(parallelPlanningFixture(seed), { sampleRate, workerCount: seed % 8 + 1 }); }
		catch (error) {
			assert.ok(error instanceof Error);
			value = { error: { name: error.name, message: error.message } };
		}
		if (plan) value = { plan: withoutReviewedLimiterAllocation(plan) };
		assert.equal(createHash('sha256').update(JSON.stringify(value)).digest('hex'), sha256,
			`seed ${String(seed)}, rate ${String(sampleRate)} must preserve the entire plan or refusal`);
	}
});
