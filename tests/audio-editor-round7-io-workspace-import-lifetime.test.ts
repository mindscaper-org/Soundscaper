/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { openDesktopWorkspaceFiles } from '../src/common/editor/ui/workspace/desktop-workspace-file-choice.ts';

for (const sameId of [false, true]) for (const changeAt of ['unchanged', 'choice', 'read'] as const) test(`desktop media choice retains its original session (${changeAt}; sameId=${sameId})`, async () => {
	let projectId = 'original';
	let generation = 1;
	let completeChoice: (descriptors: readonly unknown[]) => void = () => undefined;
	let completeRead: () => void = () => undefined;
	const choice = new Promise<readonly unknown[]>(resolve => { completeChoice = resolve; });
	const read = new Promise<void>(resolve => { completeRead = resolve; });
	let reads = 0;
	let releases = 0;
	const imported: Array<Readonly<{ projectId: string; file: File }>> = [];
	const file = new File([Uint8Array.of(1, 2, 3)], 'Dialogue.wav');
	const operation = openDesktopWorkspaceFiles({
		getProjectId: () => projectId,
		getProjectSessionKey: () => JSON.stringify([projectId, generation]),
		fileService: {
			chooseFiles: () => choice,
			async withReadDescriptors(descriptors, _request, consume) {
				assert.deepEqual(descriptors, [{ id: 'native-choice' }]);
				reads += 1;
				try { await read; return await consume([file]); }
				finally { releases += 1; }
			},
		},
		importFiles: files => { imported.push(...files.map(file => ({ projectId, file }))); },
	}, 'media', true, { destination: 'timeline' });
	if (changeAt === 'choice') { generation++; projectId = sameId ? 'original' : 'replacement'; }
	completeChoice([{ id: 'native-choice' }]);
	await Promise.resolve();
	assert.equal(reads, 1);
	if (changeAt === 'read') { generation++; projectId = sameId ? 'original' : 'replacement'; }
	completeRead();
	assert.equal(await operation, changeAt === 'unchanged' ? 1 : 0);
	assert.equal(releases, 1, 'a completed stale handoff releases its acquired native read');
	assert.deepEqual(imported, changeAt === 'unchanged' ? [{ projectId: 'original', file }] : []);
});

test('desktop File Open deliberately activates each selected project in order', async () => {
	let projectId = 'original';
	const opened: unknown[] = [];
	const count = await openDesktopWorkspaceFiles({
		getProjectId: () => projectId,
		fileService: {
			chooseFiles: () => Promise.resolve(['first', 'second']),
			withReadDescriptors: () => assert.fail('Project descriptors retain their existing dedicated reader.'),
		},
		openProjectDescriptor: descriptor => { opened.push(descriptor); projectId = String(descriptor); },
		importFiles: () => assert.fail('File Open does not import media.'),
	}, 'project', true);
	assert.equal(count, 2); assert.deepEqual(opened, ['first', 'second']);
});
