/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createMotionSavedFileConnection } from '../src/common/editor/motion-saved-file-connection.ts';
import { createMotionscaperProject } from '../src/motionscaper/editor-project.ts';
import type { MotionscaperProject } from '../src/motionscaper/editor-project-types.ts';
import { exportMotionscaperArchive } from '../src/motionscaper/editor-scape.ts';
import type { MotionSavedFileCapabilities } from '../src/common/editor/motion-saved-file-contract.ts';
function deferred() { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; }
async function fixture(projects = ['First', 'Second', 'Newest'].map(title => createMotionscaperProject({ id: 'motion-source', compositionId: 'comp', title }))) {
	const versions: Uint8Array[] = [];
	for (const project of projects) { const blob = await exportMotionscaperArchive(project, () => null); assert.ok(blob); versions.push(new Uint8Array(await blob.arrayBuffer())); }
	let generation = 1, cancelled = 0, releases = 0, polls = 0, cancelFailure = false; const tokens = new Map<string, Uint8Array>();
	const files: MotionSavedFileCapabilities = { select: () => Promise.resolve({ watchId: 'watch', name: 'Selected.mscape' }),
		poll: ({ afterGeneration }) => { polls++; if (afterGeneration === generation) return Promise.resolve({ state: 'unchanged', generation }); const token = `revision-${generation}`; tokens.set(token, versions[generation - 1]!); return Promise.resolve({ state: 'snapshot', snapshot: { token, name: 'Selected.mscape', generation, byteLength: versions[generation - 1]!.length } }); },
		read: ({ token, offset, length }) => Promise.resolve(tokens.get(token)!.slice(offset, offset + length)), release: ({ token }) => { tokens.delete(token); releases++; return Promise.resolve(); },
		cancel: () => { cancelled++; return cancelFailure ? Promise.reject(new Error('Watch close failed')) : Promise.resolve(); } };
	return { files, next: (value: number) => { generation = value; }, failCancel: (value: boolean) => { cancelFailure = value; }, cancelled: () => cancelled, polls: () => polls, releases: () => releases };
}
test('Motion saved-file connection serializes receive and polls the newest complete revision after a busy receiver', async () => {
	const f = await fixture(), received: string[] = [], started = deferred(), proceed = deferred();
	const connection = createMotionSavedFileConnection({ files: f.files, pollIntervalMs: 60000, receive: async offer => { received.push(offer.revision.project.title); if (received.length === 1) { started.resolve(); await proceed.promise; } } });
	try {
		const connecting = connection.connect(); await started.promise; f.next(2); const overlapping = connection.refresh(); f.next(3); assert.equal(f.polls(), 1); proceed.resolve(); await connecting; await overlapping;
		await connection.refresh(); assert.deepEqual(received, ['First', 'Newest']); assert.equal(connection.state().receipt?.generation, 3); assert.equal(f.releases(), 2);
	} finally { await connection.dispose(); } assert.equal(f.cancelled(), 1);
});
test('Motion saved-file connection retains accepted receipt after later receiver failure and can accept a subsequent revision', async () => {
	const f = await fixture(); const connection = createMotionSavedFileConnection({ files: f.files, pollIntervalMs: 60000, receive: offer => offer.revision.project.title === 'Second' ? Promise.reject(new Error('Corrupt retained source')) : Promise.resolve() });
	try { await connection.connect(); const accepted = connection.state().receipt; f.next(2); await connection.refresh(); assert.equal(connection.state().status, 'error'); assert.equal(connection.state().receipt, accepted);
		f.next(3); await connection.refresh(); assert.equal(connection.state().status, 'connected'); assert.equal(connection.state().receipt?.generation, 3);
	} finally { await connection.dispose(); }
});
test('Motion saved-file disconnect aborts private receive, awaits release, and retains failed watch cancellation for retry', async () => {
	const f = await fixture(), started = deferred();
	const connection = createMotionSavedFileConnection({ files: f.files, pollIntervalMs: 60000, receive: (_offer, { signal }) => new Promise((_resolve, reject) => { started.resolve(); signal!.addEventListener('abort', () => { reject(signal!.reason); }, { once: true }); }) });
	const connecting = connection.connect(); await started.promise; f.failCancel(true); await assert.rejects(connection.disconnect(), /close failed/u); await connecting;
	assert.equal(connection.state().receipt, null); assert.equal(f.releases(), 1); assert.equal(connection.state().status, 'error');
	f.failCancel(false); await connection.dispose(); assert.equal(f.cancelled(), 2); assert.equal(connection.state().status, 'disconnected');
});
test('Motion saved-file connection retries an unchanged complete snapshot after a private receiver failure', async () => {
	const f = await fixture(); let receives = 0;
	const connection = createMotionSavedFileConnection({ files: f.files, pollIntervalMs: 60000, receive: () => {
		receives += 1; return receives === 1 ? Promise.reject(new Error('temporary receiver failure')) : Promise.resolve();
	} });
	try {
		await connection.connect(); assert.equal(connection.state().status, 'error'); assert.equal(connection.state().receipt, null);
		await connection.refresh(); assert.equal(receives, 2); assert.equal(connection.state().status, 'connected');
		assert.equal(connection.state().receipt?.generation, 1); assert.equal(f.releases(), 2);
	} finally { await connection.dispose(); }
});

function changingPrimary(): readonly [MotionscaperProject, MotionscaperProject] {
	const first = createMotionscaperProject({ id: 'motion-source', compositionId: 'a', title: 'Source' });
	const original: MotionscaperProject = { ...first, compositions: [...first.compositions, { ...first.compositions[0]!, id: 'b', name: 'Other' }] };
	return [original, { ...original, primaryCompositionId: 'b' }];
}
test('Motion saved-file composition selection is pinned per successful connection and reset on reselection', async () => {
	const f = await fixture([...changingPrimary()]), received: string[] = [];
	const connection = createMotionSavedFileConnection({ files: f.files, pollIntervalMs: 60000, receive: offer => { received.push(offer.compositionId); return Promise.resolve(); } });
	try {
		await connection.connect(); f.next(2); await connection.refresh(); assert.deepEqual(received, ['a', 'a']);
		await connection.disconnect(); await connection.connect(); assert.deepEqual(received, ['a', 'a', 'b']);
	} finally { await connection.dispose(); }
});
test('Motion saved-file connection does not pin an uncommitted receive', async () => {
	const f = await fixture([...changingPrimary()]), received: string[] = []; let rejectFirst = true;
	const connection = createMotionSavedFileConnection({ files: f.files, pollIntervalMs: 60000, receive: offer => {
		if (rejectFirst) { rejectFirst = false; return Promise.reject(new Error('Receiver rejected before commit')); }
		received.push(offer.compositionId); return Promise.resolve();
	} });
	try {
		await connection.connect(); assert.equal(connection.state().receipt, null); f.next(2); await connection.refresh();
		assert.equal(connection.state().status, 'connected'); assert.deepEqual(received, ['b']);
	} finally { await connection.dispose(); }
});
test('Motion saved-file connection honors explicit composition selection across primary changes', async () => {
	const f = await fixture([...changingPrimary()]), received: string[] = [];
	const connection = createMotionSavedFileConnection({ files: f.files, compositionId: 'b', pollIntervalMs: 60000, receive: offer => { received.push(offer.compositionId); return Promise.resolve(); } });
	try { await connection.connect(); f.next(2); await connection.refresh(); assert.deepEqual(received, ['b', 'b']); }
	finally { await connection.dispose(); }
});
