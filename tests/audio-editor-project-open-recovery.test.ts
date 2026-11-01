/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { withProjectOpenRecovery } from '../src/common/editor/controller/document/project-open-recovery.ts';

test('the shared recovery boundary preserves failures with no recoverable data', async () => {
	const failure = new Error('Unreadable project');
	let inspections = 0;
	await assert.rejects(withProjectOpenRecovery(() => { throw failure; }, async (error) => {
		inspections += 1; assert.equal(error, failure); return null;
	}), (error) => error === failure);
	assert.equal(inspections, 1);
});

test('a failed recovery is never replayed and keeps its actionable diagnostic', async () => {
	const recoveryFailure = new Error('No retained version or readable document remains.');
	let attempts = 0;
	await assert.rejects(withProjectOpenRecovery(() => { throw new Error('Damage'); }, () => {
		attempts += 1; return Promise.reject(recoveryFailure);
	}), (error) => error === recoveryFailure);
	assert.equal(attempts, 1);
});
