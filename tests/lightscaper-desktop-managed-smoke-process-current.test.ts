/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { launchLightscaperManagedSmokeProcessCurrentV1 } from '../scripts/lib/lightscaper-desktop-managed-smoke-process-current-v1.ts';

const options = { deadlineMs: 3_000, retirementGraceMs: 100 };

test('Lightscaper managed process records actual successful exit and retired owned readers', { skip: process.platform === 'win32' }, async () => {
	const receipt = await launchLightscaperManagedSmokeProcessCurrentV1(process.execPath, ['--eval', 'console.log("real child");'], options);
	assert.equal(receipt.exitCode, 0); assert.equal(receipt.readersRetired, true); assert.equal(receipt.expired, false);
	assert.match(receipt.stdout, /real child/u); assert.ok(receipt.processId > 0);
});

test('Lightscaper nonzero process still retires its real detached-group descendant before returning', { skip: process.platform !== 'linux' }, async () => {
	const script = 'require("node:child_process").spawn(process.execPath,["--eval","setInterval(()=>{},1000)"],{stdio:"ignore"});process.exit(7);';
	const receipt = await launchLightscaperManagedSmokeProcessCurrentV1(process.execPath, ['--eval', script], options);
	assert.equal(receipt.exitCode, 7); assert.equal(receipt.readersRetired, true);
	assert.equal(receipt.forcedGroupRetirement, true);
});

test('Lightscaper timeout joins the actual killed owned process group and reports timeout honestly', { skip: process.platform === 'win32' }, async () => {
	const receipt = await launchLightscaperManagedSmokeProcessCurrentV1(process.execPath, ['--eval', 'setInterval(()=>{},1000);'],
		{ deadlineMs: 200, retirementGraceMs: 100 });
	assert.equal(receipt.expired, true); assert.equal(receipt.readersRetired, true);
	assert.notEqual(receipt.exitCode, 0);
});
