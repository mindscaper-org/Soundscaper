/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act, useContext } from 'react';
import { createRoot } from 'react-dom/client';
import { TimeCodeMusicalContext, type TimeCodeMusicalMap } from '../vendor/audacity-design-system/components/src/TimeCode/time-code-musical-context.ts';
import EditorMusicalTimeCodeProvider from '../src/common/editor/ui/EditorMusicalTimeCodeProvider.tsx';
import { createMusicalEndingDurationTimeCodeMap, type MusicalTimeCodeProject } from '../src/common/editor/ui/time-code-musical-map.ts';
import { installReactTestDom } from './helpers/react-test-dom.ts';
import { secondsToSampleFrame } from '../src/common/editor/timeline-time.ts';

for (const [endingSeconds, tempoChange, expected] of [[6, true, 2], [6, false, 4], [4, true, 4]] as const) {
	test(`the shared duration provider counts backward from ${endingSeconds}s with changing=${String(tempoChange)}`, async context => {
		const dom = installReactTestDom();
		const root = createRoot(dom.container as unknown as Element);
		const globals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
		const previous = globals.IS_REACT_ACT_ENVIRONMENT; globals.IS_REACT_ACT_ENVIRONMENT = true;
		context.after(async () => { await act(async () => root.unmount()); dom.restore(); globals.IS_REACT_ACT_ENVIRONMENT = previous; });
		const project: MusicalTimeCodeProject = { sampleRate: 48_000,
			tempoMap: { mode: 'musical', events: [{ beat: { num: 0, den: 1 }, bpm: { num: 60, den: 1 } },
				...tempoChange ? [{ beat: { num: 4, den: 1 }, bpm: { num: 120, den: 1 } }] : []] },
			signatureMap: { events: [{ bar: 0, numerator: 4, denominator: 4 }] } };
		const snapshot = { project };
		let clock: TimeCodeMusicalMap | undefined;
		function Probe() { clock = useContext(TimeCodeMusicalContext); return null; }
		const controller = { getSnapshot: () => snapshot, subscribe: () => () => undefined };
		await act(async () => root.render(<EditorMusicalTimeCodeProvider
			controller={controller} originFrame={0} endFrame={endingSeconds * 48_000}><Probe /></EditorMusicalTimeCodeProvider>));
		assert.ok(clock);
		assert.equal(clock.toSeconds(1, 1), expected, 'one bar is measured in the trailing audio interval');
		assert.deepEqual(clock.fromSeconds(expected), { bar: 1, beat: 1, beatsPerBar: 4 });
	});
}

for (const mode of ['musical', 'sampleLocked'] as const) test(`ending durations retain ${mode} tempo and preceding signatures`, () => {
	const project: MusicalTimeCodeProject = { sampleRate: 48_000,
		tempoMap: { mode, events: [
			{ beat: { num: 0, den: 1 }, bpm: { num: 60, den: 1 }, ...mode === 'sampleLocked' ? { samplePosition: secondsToSampleFrame(0, 48_000) } : {} },
			{ beat: { num: 4, den: 1 }, bpm: { num: 120, den: 1 }, ...mode === 'sampleLocked' ? { samplePosition: secondsToSampleFrame(4, 48_000) } : {} },
		] }, signatureMap: { events: [{ bar: 0, numerator: 4, denominator: 4 }, { bar: 2, numerator: 3, denominator: 8 }] } };
	for (const [end, expected] of [[4, 4], [5, 3], [6, 2], [6.25, .75]] as const) {
		const clock = createMusicalEndingDurationTimeCodeMap(project, end * 48_000);
		assert.equal(clock.toSeconds(1, 1), expected);
		assert.deepEqual(clock.fromSeconds(expected), { bar: 1, beat: 1, beatsPerBar: 4 });
	}
	const clock = createMusicalEndingDurationTimeCodeMap(project, 6.75 * 48_000);
	assert.equal(clock.toSeconds(1, 1), .75);
	assert.equal(clock.toSeconds(2, 1), 2.75);
	assert.deepEqual(clock.fromSeconds(2.75), { bar: 2, beat: 1, beatsPerBar: 4 });
	assert.equal(clock.toSeconds(100, 1), 6.75, 'a fade cannot traverse before project zero');
	assert.deepEqual(clock.fromSeconds(100), clock.fromSeconds(6.75));
});
