/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { createMotionQualificationNative } from '../desktop/motionscaper-qualification-native.ts';
import { motionQualificationProcessIdentity, type MotionQualificationOwner } from '../desktop/motionscaper-qualification-policy.ts';
import { selectMotionOwnedProcesses } from '../scripts/performance/motionscaper-sustained-process.ts';

test('Native process adaptation retains descendants and orphan births while refusing recycled PIDs', () => {
	const owner = (pid: number, parent: number, birth: string): MotionQualificationOwner => ({
		platform: 'linux', pid, parent, birth, executable: '/owned/application',
	});
	const root = owner(20, 1, '100'), child = owner(21, 20, '101'), orphan = owner(22, 1, '102');
	const old = owner(23, 20, '103'), recycled = owner(23, 1, '104'), foreign = owner(24, 999, '105');
	const selected = selectMotionOwnedProcesses([root, child, orphan, recycled, foreign].map(motionQualificationProcessIdentity),
		motionQualificationProcessIdentity(root), [orphan, old].map(motionQualificationProcessIdentity));
	assert.deepEqual(selected.map(value => value.pid), [20, 21, 22]);
});

test('Linux qualification observer retains the actual process parent and executable identity', { skip: process.platform !== 'linux' }, async context => {
	const directory = await realpath(await mkdtemp(join(tmpdir(), 'motion-native-observer-')));
	context.after(async () => { await rm(directory, { recursive: true, force: true }); });
	const native = await createMotionQualificationNative(resolve(import.meta.dirname, '..'), directory);
	const current = await native.inspect(process.pid);
	assert.ok(current);
	assert.equal(current.pid, process.pid);
	assert.equal(current.parent, process.ppid);
	assert.equal(current.executable, await realpath(process.execPath));
	assert.match(current.birth, /^[1-9]\d*$/u);
});
