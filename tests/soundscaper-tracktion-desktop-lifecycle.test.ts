/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';

import type { TracktionCommand, TracktionReply } from '../desktop/tracktion-peer-contract.ts';
import { TracktionProjectService } from '../desktop/tracktion-project-service.ts';

function peer(stopsBeforePublication = false) {
	let finish!: () => void;
	const completion = new Promise<void>((resolve) => { finish = resolve; });
	let stopped = false;
	function exit(): void {
		stopped = true;
		finish();
	}
	return {
		completion, exit,
		get stopped() { return stopped; },
		async request<Command extends TracktionCommand>(command: Command): Promise<TracktionReply<Command>> {
			if (stopped) throw new Error('The utility is already stopped.');
			assert.equal(command.kind, 'project');
			if (stopsBeforePublication) exit();
			const project = { revision: 0, sampleRate: 48_000, tracks: [], nextOffset: null, canUndo: false, canRedo: false };
			return project as unknown as TracktionReply<Command>;
		},
		async close() { exit(); },
	};
}

async function projectService(context: TestContext, peers: ReturnType<typeof peer>[]) {
	const root = await mkdtemp(join(tmpdir(), 'tracktion-utility-lifecycle-'));
	const projects = [join(root, 'Saved'), join(root, 'Replacement')];
	for (const directory of projects) {
		await mkdir(directory);
		await writeFile(join(directory, 'project.tracktionedit'), '');
	}
	const owner = {};
	const lost: { owner: object; sessionId: string; message: string }[] = [];
	let selected = 0;
	const service = new TracktionProjectService({
		scratchRoot: join(root, 'scratch'), isOwnerCurrent: (caller) => caller === owner,
		chooseCreateDirectory: async () => null, chooseOpenProject: async () => join(projects[selected]!, 'project.tracktionedit'),
		chooseWave: async () => null, chooseExport: async () => null,
		startPeer: async () => {
			const running = peers.shift();
			assert.ok(running);
			return running;
		},
		onProjectLost: (owner: object, sessionId: string, message: string) => { lost.push({ owner, sessionId, message }); },
	});
	context.after(async () => {
		try { await service.dispose(); }
		finally { await rm(root, { force: true, recursive: true }); }
	});
	async function open(index = 0) {
		selected = index;
		const result = await service.request(owner, { kind: 'open' });
		assert.ok(result && 'sessionId' in result);
		return result;
	}
	return { service, owner, lost, open };
}

void test('an idle Tracktion utility exit expires the visible project and permits reopening it', async (context) => {
	const first = peer();
	const { service, owner, lost, open } = await projectService(context, [first, peer()]);
	const previous = await open();
	first.exit();
	await first.completion;
	assert.equal(lost.length, 1);
	assert.equal(lost[0]?.owner, owner);
	assert.equal(lost[0]?.sessionId, previous.sessionId);
	assert.match(lost[0]?.message ?? '', /Tracktion.*unexpectedly/u);
	await assert.rejects(service.request(owner, { kind: 'project', sessionId: previous.sessionId, offset: 0 }), /handle has expired/u);
	const reopened = await open();
	assert.notEqual(reopened.sessionId, previous.sessionId);
	assert.deepEqual(reopened.project, previous.project);
});

void test('closing or replacing the Tracktion project does not notify project loss', async (context) => {
	const { service, owner, lost, open } = await projectService(context, [peer(), peer()]);
	await open();
	const replacement = await open(1);
	assert.deepEqual(lost, []);
	await service.request(owner, { kind: 'close', sessionId: replacement.sessionId });
	assert.deepEqual(lost, []);
});

void test('a Tracktion utility that stopped before publication cannot replace the open project', async (context) => {
	const { service, owner, lost, open } = await projectService(context, [peer(), peer(true)]);
	const current = await open();
	await assert.rejects(open(1), /Tracktion.*unexpectedly/u);
	assert.deepEqual(lost, []);
	assert.deepEqual(await service.request(owner, { kind: 'project', sessionId: current.sessionId, offset: 0 }), current.project);
});
