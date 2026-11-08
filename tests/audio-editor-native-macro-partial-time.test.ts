/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { parseAudacityEffectMacro, serializeAudacityEffectMacro } from '../src/common/editor/effect-macros.js';
import { createMacroCommandStep, isMacroCommandStep } from '../src/common/editor/macro-command-steps.ts';
import { createMacroCommandService } from '../src/common/editor/controller/effects/internal/macro/macro-command-service.ts';

for (const command of ['SelectTime', 'Select']) for (const [field, params] of [
	['Start="0.2"', { start: 0.2, end: 0 }], ['End="0.4"', { start: 0, end: 0.4 }],
] as const) test(`native ${command} ${field} retains the omitted edge's zero default`, () => {
	const step = imported(`${command}:${field}`);
	assert.deepEqual(step.params, params);
	let applied: readonly number[] = [];
	const service = createMacroCommandService({
		getProject: () => ({ tracks: [{ id: 'voice' }], selection: { startFrame: 4800, endFrame: 38_400, trackIds: ['voice'] } }),
		projectSampleRate: () => 48_000, timelineDurationFrames: () => 38_400,
		setExactSelection: (start, end) => { applied = [start, end]; },
	});
	service.runMacroCommand(step);
	assert.deepEqual(applied, [params.start * 48_000, params.end * 48_000]);
});

for (const command of ['SelectTime', 'Select']) test(`local partial ${command} retains its behavior and refuses incompatible native delivery`, () => {
	const step = createMacroCommandStep(command, { params: { start: 0.2 } });
	assert.deepEqual(step.params, { start: 0.2 });
	assert.throws(() => serializeAudacityEffectMacro([step]), /partial.*time selection/iu);
});

test('no-edge and both-edge native commands keep their established meaning', () => {
	for (const line of ['SelectTime:', 'Select:Track="1"', 'SelectTime:Start="0.2" End="0.4" RelativeTo="Selection"']) {
		const step = imported(line);
		const roundtrip = imported(serializeAudacityEffectMacro([step]));
		assert.deepEqual(roundtrip.params, step.params);
	}
	assert.deepEqual(imported('SelectTime:').params, {});
	assert.deepEqual(imported('Select:Track="1"').params, { track: 1 });
});

test('native zero defaults follow each relative time origin', () => {
	for (const [relative, expected] of [
		['ProjectStart', [9600, 0]], ['Project', [9600, 38_400]], ['ProjectEnd', [28_800, 38_400]],
		['SelectionStart', [14_400, 4800]], ['Selection', [14_400, 24_000]], ['SelectionEnd', [14_400, 24_000]],
	] as const) {
		const step = imported(`SelectTime:Start="0.2" RelativeTo="${relative}"`);
		let applied: readonly number[] = [];
		createMacroCommandService({
			getProject: () => ({ tracks: [{ id: 'voice' }], selection: { startFrame: 4800, endFrame: 24_000 } }),
			projectSampleRate: () => 48_000, timelineDurationFrames: () => 38_400,
			setExactSelection: (start, end) => { applied = [start, end]; },
		}).runMacroCommand(step);
		assert.deepEqual(applied, expected, relative);
	}
});

function imported(line: string) {
	const step = parseAudacityEffectMacro(line, { idFactory: () => 'native' }).effects[0];
	assert.ok(isMacroCommandStep(step));
	return step;
}

for (const command of ['SelectFrequencies', 'Select']) for (const edge of ['Low', 'High']) {
	test(`native ${command} ${edge}-only frequencies start with the missing zero edge`, () => {
		const step = imported(`${command}:${edge}="500"`);
		assert.deepEqual(step.params, { low: 0, high: 500 });
	});
}

for (const command of ['SelectFrequencies', 'Select']) test(`local partial ${command} frequency delivery refuses changed native defaults`, () => {
	const step = createMacroCommandStep(command, { params: { low: 500 } });
	assert.deepEqual(step.params, { low: 500 });
	assert.throws(() => serializeAudacityEffectMacro([step]), /partial.*frequency selection/iu);
});

test('native frequency bounds retain ordering, no-change behavior and admission', () => {
	assert.deepEqual(imported('SelectFrequencies:Low="500" High="0"').params, { low: 0, high: 500 });
	assert.deepEqual(imported('SelectFrequencies:').params, {});
	assert.throws(() => imported('SelectFrequencies:Low="0"'), /empty.*frequency range/iu);
	assert.throws(() => imported('SelectFrequencies:Low="not-a-number"'), /finite number/iu);
	assert.throws(() => imported('SelectFrequencies:Low="-1"'), /between/iu);
});
