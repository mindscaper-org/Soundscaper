/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createFramescaperCaptureActiveTimeClock } from '../src/common/editor/controller/capture/internal/framescaper-capture-active-time-clock.ts';

test('late packet arrivals project through completed/current pauses without rewinding lifecycle observations', () => {
	const clock = createFramescaperCaptureActiveTimeClock(100);
	clock.pause(1100); clock.resume(2100); clock.snapshot(3100);
	assert.deepEqual([600, 1600, 2600].map(at => clock.activeTimeUsAt(at)), [500000, 1000000, 1500000]);
	clock.pause(4100);
	assert.equal(clock.activeTimeUsAt(4600), 3000000);
	clock.stop(5100);
	assert.equal(clock.activeTimeUsAt(5900), 3000000);
	assert.equal(clock.snapshot(5100).activeTimeUs, 3000000);
});

test('a packet received during initialization does not count the journaled setup span as media time', () => {
	const clock = createFramescaperCaptureActiveTimeClock(100, true);
	clock.resume(3100);
	assert.equal(clock.activeTimeUsAt(2000), 0);
	assert.equal(clock.activeTimeUsAt(3200), 100000);
});
