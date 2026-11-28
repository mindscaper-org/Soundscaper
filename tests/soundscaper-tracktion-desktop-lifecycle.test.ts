/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
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
	const scratchRoot = join(root, 'scratch');
	const projects = [join(root, 'Saved'), join(root, 'Replacement')];
	for (const directory of projects) {
		await mkdir(directory);
		await writeFile(join(directory, 'project.tracktionedit'), '');
	}
	const owner = {};
	const lost: { owner: object; sessionId: string; message: string }[] = [];
	let selected = 0;
	const service = new TracktionProjectService({
		scratchRoot, isOwnerCurrent: (caller) => caller === owner,
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
	return { service, owner, lost, open, scratchRoot };
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

for (const command of ['close', 'open'] as const) {
	void test(`Tracktion ${command} completes when the retired peer's temporary files cannot be removed`, {
		skip: process.platform === 'win32' || process.getuid?.() === 0,
	}, async (context) => {
		const retiring = peer();
		const next = peer();
		const cleanupError = context.mock.method(console, 'error', () => undefined);
		const { service, owner, lost, open, scratchRoot } = await projectService(context, [retiring, next]);
		const before = await open();
		const [directory] = (await readdir(scratchRoot)).filter((name) => name.startsWith('edit-'));
		assert.ok(directory);
		const scratch = join(scratchRoot, directory);
		await chmod(scratch, 0o500);
		try {
			if (command === 'close') {
				assert.equal(await service.request(owner, { kind: 'close', sessionId: before.sessionId }), null);
			} else {
				const replacement = await open(1);
				assert.deepEqual(await service.request(owner, { kind: 'project', sessionId: replacement.sessionId, offset: 0 }), replacement.project);
			}
			assert.equal(retiring.stopped, true);
			assert.equal(next.stopped, false);
			assert.deepEqual(lost, []);
			assert.equal(cleanupError.mock.callCount(), 1);
			await assert.rejects(service.request(owner, { kind: 'project', sessionId: before.sessionId, offset: 0 }), /handle has expired/u);
		} finally { await chmod(scratch, 0o700); }
		await service.dispose();
		assert.deepEqual(await readdir(scratchRoot), []);
	});
}

void test('Tracktion reports a peer shutdown failure even if its temporary cleanup fails', {
	skip: process.platform === 'win32' || process.getuid?.() === 0,
}, async (context) => {
	const retiring = peer();
	const failure = new Error('The Tracktion utility could not stop.');
	context.mock.method(retiring, 'close', async () => {
		retiring.exit();
		throw failure;
	});
	context.mock.method(console, 'error', () => undefined);
	const { service, owner, open, scratchRoot } = await projectService(context, [retiring]);
	const project = await open();
	const [directory] = (await readdir(scratchRoot)).filter((name) => name.startsWith('edit-'));
	assert.ok(directory);
	const scratch = join(scratchRoot, directory);
	await chmod(scratch, 0o500);
	try {
		await assert.rejects(service.request(owner, { kind: 'close', sessionId: project.sessionId }), failure);
	} finally { await chmod(scratch, 0o700); }
	await service.dispose();
	assert.deepEqual(await readdir(scratchRoot), []);
});
