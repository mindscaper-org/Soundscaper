/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createFramescaperNativeCompositionConnection } from '../src/common/editor/ui/framescaper-composition-native-connection.ts';
import type { MotionSavedFileCapabilities } from '../src/common/editor/motion-saved-file-contract.ts';
import { normalizeMotionCompositionOffer } from '../src/common/editor/motion-link-protocol.ts';
import { createMotionscaperProject } from '../src/motionscaper/editor-project.ts';
import type { MotionscaperProject } from '../src/motionscaper/editor-project-types.ts';
import { exportMotionscaperArchive } from '../src/motionscaper/editor-scape.ts';

function fixture() {
	let project = { id: 'owner' }, cancelFails = true, cancels = 0;
	const listeners = new Set<() => void>();
	const controller = { get project() { return project; }, getSnapshot: () => ({ readOnly: false }), subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; } };
	const files: MotionSavedFileCapabilities = {
		select: () => Promise.resolve({ watchId: 'watch', name: 'Selected.mscape' }),
		poll: () => Promise.resolve({ state: 'unchanged', generation: 0 }),
		read: () => Promise.reject(new Error('Unexpected read')), release: () => Promise.resolve(),
		cancel: () => { cancels++; return cancelFails ? Promise.reject(new Error('Native cleanup failed')) : Promise.resolve(); },
	};
	const context = { links: { receive: () => Promise.resolve() } };
	return { controller, context, files, cancels: () => cancels, allowCleanup() { cancelFails = false; }, switchProject() { project = { id: 'another-owner' }; for (const listener of listeners) listener(); } };
}
test('native link disposal keeps failed cleanup observable until a successful retry', async () => {
	const f = fixture(), connection = createFramescaperNativeCompositionConnection(f.controller, f.context, f.files);
	let notifications = 0; connection.subscribe(() => { notifications++; }); await connection.connect();
	await assert.rejects(connection.dispose(), /Native cleanup failed/u); assert.equal(connection.snapshot().status, 'error');
	const beforeRetry = notifications; f.allowCleanup(); await connection.dispose();
	assert.equal(connection.snapshot().status, 'disconnected'); assert.ok(notifications > beforeRetry); assert.equal(f.cancels(), 2);
});
test('native project-switch cleanup failure stays reviewable and Disconnect can retry it', async () => {
	const f = fixture(), connection = createFramescaperNativeCompositionConnection(f.controller, f.context, f.files);
	await connection.connect(); f.switchProject();
	await new Promise<void>(resolve => setTimeout(resolve, 0)); assert.equal(connection.snapshot().status, 'error');
	await assert.rejects(connection.connect(), /Disconnect/u); f.allowCleanup(); await connection.disconnect();
	assert.equal(connection.snapshot().status, 'disconnected'); assert.equal(f.cancels(), 2); await connection.dispose();
});

test('native links retain the selected composition when the source primary changes', async () => {
	const first = createMotionscaperProject({ id: 'motion-source', compositionId: 'a', title: 'Source' });
	const original: MotionscaperProject = { ...first, compositions: [...first.compositions, { ...first.compositions[0]!, id: 'b', name: 'Other' }] };
	const primaryChanged: MotionscaperProject = { ...original, primaryCompositionId: 'b' };
	const edited: MotionscaperProject = { ...primaryChanged, compositions: primaryChanged.compositions.map(composition => composition.id === 'a' ? { ...composition, name: 'Edited A' } : composition) };
	const projects = [original, primaryChanged, edited, { ...edited, id: 'replacement-project' }];
	const versions = await Promise.all(projects.map(async project => {
		const blob = await exportMotionscaperArchive(project, () => null); assert.ok(blob); return new Uint8Array(await blob.arrayBuffer());
	}));
	let generation = 1; const tokens = new Map<string, Uint8Array>();
	const files: MotionSavedFileCapabilities = {
		select: () => Promise.resolve({ watchId: 'watch', name: 'Selected.mscape' }),
		poll: ({ afterGeneration }) => {
			if (afterGeneration === generation) return Promise.resolve({ state: 'unchanged', generation });
			const token = `revision-${generation}`, bytes = versions[generation - 1]!; tokens.set(token, bytes);
			return Promise.resolve({ state: 'snapshot', snapshot: { token, name: 'Selected.mscape', generation, byteLength: bytes.length } });
		},
		read: ({ token, offset, length }) => Promise.resolve(tokens.get(token)!.slice(offset, offset + length)),
		release: ({ token }) => { tokens.delete(token); return Promise.resolve(); }, cancel: () => Promise.resolve(),
	};
	const received: { compositionId: string; name: string }[] = [];
	const controller = { project: { id: 'owner' }, getSnapshot: () => ({ readOnly: false }), subscribe: () => () => {} };
	const connection = createFramescaperNativeCompositionConnection(controller, { links: { receive: offer => {
		const value = normalizeMotionCompositionOffer(offer);
		received.push({ compositionId: value.compositionId, name: value.revision.project.compositions.find(composition => composition.id === value.compositionId)!.name }); return Promise.resolve();
	} } }, files);
	try {
		await connection.connect(); assert.deepEqual(received.map(value => value.compositionId), ['a']);
		generation = 2; await connection.refresh(); assert.equal(connection.snapshot().status, 'connected');
		generation = 3; await connection.refresh(); assert.equal(connection.snapshot().status, 'connected');
		assert.deepEqual(received, [{ compositionId: 'a', name: 'Source' }, { compositionId: 'a', name: 'Source' }, { compositionId: 'a', name: 'Edited A' }]);
		const accepted = connection.snapshot().receipt;
		generation = 4; await connection.refresh(); assert.equal(connection.snapshot().status, 'error'); assert.equal(connection.snapshot().receipt, accepted); assert.equal(received.length, 3);
	} finally { await connection.dispose(); }
});
