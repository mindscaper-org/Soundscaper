/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createHarness } from './helpers/effect-macro-service-fixture.ts';
import { parseAudacityEffectMacro } from '../src/common/editor/effect-macros.js';
import type { RunStreamedEffects } from '../src/common/editor/controller/effects/internal/streamed/streamed-effect-service.ts';

const ISSUE_17_MACRO = 'SelectAll:\nNormalize:ApplyVolume="1" PeakLevel="0" RemoveDcOffset="1" StereoIndependent="0"\nSelectAll:\nLoudnessNormalization:DualMono="1" LUFSLevel="-16" NormalizeTo="0" RMSLevel="-1" StereoIndependent="1"';

test('LP-length imported normalization steps use bounded execution under the existing memory limit', async () => {
	const parsed = parseAudacityEffectMacro(ISSUE_17_MACRO);
	assert.deepEqual(parsed.ignoredCommands, []);
	for (const effect of [parsed.effects[1]!, parsed.effects[3]!]) {
		const calls: Parameters<RunStreamedEffects>[] = [];
		const harness = createHarness({ targetDurationFrames: 48_000 * 60 * 45, memoryLimitBytes: 256 * 1024 ** 2,
			runStreamedEffects: async (...args) => { calls.push(args); args[1].assertCurrent(); } });
		assert.equal(await harness.service.runEffectMacro({ name: 'LP', effects: [effect] }), true);
		assert.equal(calls.length, 1);
		assert.equal(calls[0]![0][0]!.target.durationFrames, 129_600_000);
		assert.equal(calls[0]![1].effectName, 'LP');
		assert.equal(harness.processing, false);
		assert.equal(harness.dryRanges.length, 0, 'the full-length PCM path must never start');
		assert.equal(harness.persisted.length, 0);
	}
});

test('unstreamable effects retain their memory admission refusal', async () => {
	let called = false;
	const harness = createHarness({ targetDurationFrames: 48_000 * 60 * 45, memoryLimitBytes: 256 * 1024 ** 2,
		runStreamedEffects: async () => { called = true; } });
	await assert.rejects(harness.service.runEffectMacro({ effects: [{ type: 'audacity-reverse', params: {} }] }), /Too large/u);
	assert.equal(called, false);
});

test('small normalization macros use the same streaming path below the memory ceiling', async () => {
	let called = false;
	const harness = createHarness({ targetDurationFrames: 140003, memoryLimitBytes: 256 * 1024 ** 2,
		runStreamedEffects: async (_plans, options) => { called = true; options.assertCurrent(); } });
	await harness.service.runEffectMacro({ effects: [{ type: 'audacity-normalize', params: {} }] });
	assert.equal(called, true); assert.equal(harness.dryRanges.length, 0);
});
