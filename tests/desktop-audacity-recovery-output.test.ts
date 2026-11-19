/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { link, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assertRecoveryOutputPath } from '../desktop/recovery-output-path.ts';
import { registerFileCapabilityIpc } from '../desktop/main-file-capability-ipc.mjs';

test('recovery output protects original paths and hard-link aliases while permitting a new destination', async () => {
	const folder = await mkdtemp(join(tmpdir(), 'recovery-output-'));
	try {
		const source = join(folder, 'original.aup3'), alias = join(folder, 'alias.aup3'), owner = {};
		await writeFile(source, 'original'); await link(source, alias);
		const entries = [{ owner, sourcePath: source, path: join(folder, 'private-snapshot.aup3') }];
		await assert.rejects(assertRecoveryOutputPath(source, owner, entries), /original project/u);
		await assert.rejects(assertRecoveryOutputPath(alias, owner, entries), /original project/u);
		await assertRecoveryOutputPath(join(folder, 'Recovered.aup3'), owner, entries);
	} finally { await rm(folder, { recursive: true, force: true }); }
});

test('the native recovery save chooser checks the destination before granting a save and again before publication', async () => {
	const handlers = new Map<string, (event: unknown, request: unknown) => Promise<unknown>>();
	const owner = {}, checks: string[] = [], granted: Array<{ beforeCommit: () => Promise<void> }> = [];
	registerFileCapabilityIpc({
		channels: { chooseSaveTarget: 'save' },
		desktopSmokeProbe: { resolveOpenPaths: () => null, resolveSavePath: async () => null },
		dialog: { showOpenDialog: async () => ({ canceled: true, filePaths: [] }), showSaveDialog: async () => ({ canceled: false, filePath: '/recovered.aup4' }) },
		handle: (channel: string, callback: (event: unknown, request: unknown) => Promise<unknown>) => { handlers.set(channel, callback); },
		opaqueId: (value: unknown) => String(value), ownerFor: () => owner, pendingOpenProjects: new Map(), windowFor: () => null,
		readCapabilities: { assertRecoveryOutputPath: async (path: string, options: { owner: object }) => { assert.equal(options.owner, owner); checks.push(path); } },
		saves: {}, saveTargets: { registerPath: (_path: string, options: { beforeCommit: () => Promise<void> }) => { granted.push(options); return { id: 'output' }; } },
	});
	await handlers.get('save')!({}, { purpose: 'audacity-recovery', suggestedName: 'Recovered.aup4' });
	assert.deepEqual(checks, ['/recovered.aup4']);
	assert.equal(granted.length, 1);
	await granted[0]!.beforeCommit();
	assert.deepEqual(checks, ['/recovered.aup4', '/recovered.aup4']);
});
