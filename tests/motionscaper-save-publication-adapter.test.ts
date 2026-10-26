/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { beginMotionscaperDesktopSave, selectMotionscaperDesktopArchive } from '../src/motionscaper/desktop-file-adapter.ts';
import type { MotionDesktopFiles, MotionSaveFileReceipt } from '../src/motionscaper/desktop-file-contract.ts';
import { takeMotionscaperDesktopLaunch } from '../src/motionscaper/desktop-launch-adapter.ts';

const prepared: MotionSaveFileReceipt = { name: 'Saved.mscape', byteLength: 3, sha256: 'a'.repeat(64), transactionId: 'transaction', publication: 'prepared' };
function fixture() {
	const phases: (string | undefined)[] = []; let cancels = 0, published = false, lostReply = false;
	const files: MotionDesktopFiles = {
		selectOpen: async () => null, read: async () => new Uint8Array(), release: async () => undefined, bindOpened: async () => undefined,
		beginSave: async () => ({ token: 'private-capability' }), write: async () => undefined,
		commit: async request => {
			phases.push(request.phase);
			if (request.phase === 'publish') { published = true; if (lostReply) throw new Error('IPC reply lost'); }
			return { ...prepared, publication: published ? 'published' : 'prepared' };
		},
		cancel: async () => { cancels++; },
	};
	return { files, phases, cancels: () => cancels, loseReply() { lostReply = true; } };
}
test('native archive adapter requires a positive prepared receipt, exposes status after lost publish reply, and acknowledges only explicitly', async () => {
	const f = fixture(); const output = await beginMotionscaperDesktopSave(f.files, { projectId: 'motion', suggestedName: 'Saved.mscape' }); assert.ok(output);
	const writer = output.writable.getWriter(); await writer.write(new Uint8Array([1, 2, 3])); await writer.close();
	assert.deepEqual(await output.prepare(), prepared); assert.equal(f.cancels(), 0);
	f.loseReply(); await assert.rejects(output.commit(), /IPC reply lost/u);
	assert.equal((await output.status()).publication, 'published'); assert.equal(f.cancels(), 0);
	await output.abort(); await output.abort(); assert.equal(f.cancels(), 1);
	await output.acknowledge(); await output.acknowledge(); assert.equal(f.cancels(), 2);
	assert.equal((await output.status()).publication, 'published'); assert.deepEqual(f.phases, ['prepare', 'publish', 'status', 'status']);
});
test('native archive preparation refuses a legacy or mismatching receipt instead of treating a complete file as publication authority', async () => {
	for (const receipt of [{ ...prepared, publication: undefined }, { ...prepared, transactionId: undefined }, { ...prepared, byteLength: 4 }]) {
		const f = fixture(); f.files.commit = async () => receipt;
		const output = await beginMotionscaperDesktopSave(f.files, { projectId: 'motion', suggestedName: 'Saved.mscape' }); assert.ok(output);
		const writer = output.writable.getWriter(); await writer.write(new Uint8Array([1, 2, 3])); await writer.close();
		await assert.rejects(output.prepare(), /receipt|prepar/iu); await output.abort();
	}
});
test('native archive selection forwards only authenticated opaque recovery metadata', async () => {
	const f = fixture(), recovery = { transactionId: 'transaction', publication: 'rolled-back' as const, byteLength: 3, sha256: 'a'.repeat(64) };
	const acknowledgements: boolean[] = []; f.files.release = async request => { acknowledgements.push(request.acknowledgeRecovery === true); };
	f.files.selectOpen = async () => ({ token: 'read-capability', name: 'Saved.mscape', byteLength: 3, recoveredPublication: recovery });
	const selected = await selectMotionscaperDesktopArchive(f.files); assert.ok(selected);
	assert.deepEqual(selected.recoveredPublication, recovery); await selected.release();
	const reconciled = await selectMotionscaperDesktopArchive(f.files); assert.ok(reconciled); reconciled.markRecoveryReconciled(); await reconciled.release();
	assert.deepEqual(acknowledgements, [false, true]);
});
test('native OS launch preserves recovery correlation and acknowledges its journal only after local reconciliation', async () => {
	const f = fixture(), recovery = { transactionId: 'transaction', publication: 'published' as const, byteLength: 3, sha256: 'a'.repeat(64) };
	const acknowledgements: boolean[] = []; let launchAcknowledgements = 0;
	f.files.release = async request => { acknowledgements.push(request.acknowledgeRecovery === true); };
	const launch = { take: async () => ({ token: 'launched-read', name: 'Saved.mscape', byteLength: 3, recoveredPublication: recovery }),
		acknowledge: async () => { launchAcknowledgements++; }, onPending: () => () => undefined };
	const selected = await takeMotionscaperDesktopLaunch(f.files, launch); assert.ok(selected);
	assert.deepEqual(selected.recoveredPublication, recovery); selected.markRecoveryReconciled(); await selected.release(); await selected.release();
	assert.deepEqual(acknowledgements, [true]); assert.equal(launchAcknowledgements, 1);
});

test('Save-dialog recovery exposes a status and ACK-only output without streaming a replacement archive', async () => {
	const f = fixture(), recovered = { transactionId: 'transaction', publication: 'rolled-back' as const, byteLength: 3, sha256: 'a'.repeat(64) };
	f.files.beginSave = async () => ({ token: 'recovery-only', recoveredPublication: recovered });
	f.files.commit = async request => { f.phases.push(request.phase); assert.equal(request.phase, 'status'); assert.equal(request.byteLength, 3); return { name: 'Saved.mscape', ...recovered }; };
	const output = await beginMotionscaperDesktopSave(f.files, { projectId: 'motion', suggestedName: 'Saved.mscape' }); assert.ok(output);
	assert.deepEqual(output.recoveredPublication, recovered);
	await assert.rejects(output.writable.getWriter().write(new Uint8Array([1])), /recovery/iu);
	await assert.rejects(output.prepare(), /recovery/iu); await assert.rejects(output.commit(), /recovery/iu);
	assert.equal((await output.status()).publication, 'rolled-back'); assert.deepEqual(f.phases, ['status']);
	await output.abort(); await output.abort(); assert.equal(f.cancels(), 1);
	await output.acknowledge(); await output.acknowledge(); assert.equal(f.cancels(), 2);
	await assert.rejects(output.commit(), /recovery/iu);
});
