/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createFramescaperCaptureSetupDefaults,
} from '../src/common/editor/controller/capture/internal/framescaper-capture-setup-defaults.ts';

test('capture setup defaults preserve current selections and publish changes', () => {
	let changes = 0;
	const defaults = createFramescaperCaptureSetupDefaults(() => { changes += 1; });
	assert.deepEqual(defaults.snapshot, { destination: 'both', countdownMs: 3_000 });

	defaults.update({ destination: 'project-bin' });
	defaults.update({ countdownMs: 0 });
	assert.deepEqual(defaults.snapshot, { destination: 'project-bin', countdownMs: 0 });
	assert.equal(changes, 2);
});
