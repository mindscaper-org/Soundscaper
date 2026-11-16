/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createAudacityRecoverySelection, type AudacityRecoveryFiles } from '../src/common/editor/controller/document/audacity-recovery-selection.ts';

function fixture(cancelSave = false, failOpen = false) {
	const events: string[] = [];
	const file = new File(['project'], 'unsaved.aup4unsaved');
	const files: AudacityRecoveryFiles = {
		isDesktop: true,
		chooseFiles: async () => [{ id: 'selected', name: file.name }],
		withReadDescriptors: async (_descriptors, options, consume) => {
			assert.equal(options.retainReads, true); events.push('read'); return consume([file]);
		},
		releaseRead: async id => { events.push(`release:${id}`); },
		chooseSaveTarget: async request => {
			assert.equal(request.purpose, 'audacity-recovery');
			assert.equal(request.suggestedName, 'unsaved (Recovered).aup4');
			events.push('choose-output'); return cancelSave ? null : { id: 'output' };
		},
		saveFile: async request => { assert.deepEqual(request.bytes, Uint8Array.of(42)); events.push('save'); },
		releaseSaveTarget: () => { events.push('release-output'); },
	};
	const selection = createAudacityRecoverySelection(files, () => ({
		openFile: async (_id, selected, options) => { assert.equal(selected, file); assert.equal(options.recover, true); events.push('open'); if (failOpen) throw new Error('Source read failed'); },
		call: async type => { events.push(type); return type === 'repair-native-copy' ? { bytes: Uint8Array.of(42), mimeType: 'application/x-audacity-project' } : {}; },
		dispose: () => { events.push('dispose-worker'); },
	}));
	return { selection, events, files };
}

test('desktop recovery retains its read capability across preview and native-copy save, then releases it once', async () => {
	const { selection, events } = fixture();
	await selection.choose(); await selection.inspect();
	assert.equal(events.includes('release:selected'), false);
	assert.equal(await selection.saveCopy(), true);
	assert.ok(events.indexOf('choose-output') < events.indexOf('repair-native-copy'));
	assert.deepEqual(events.filter(event => event === 'delete' || event === 'dispose-worker'), ['delete', 'dispose-worker', 'delete', 'dispose-worker']);
	await selection.dispose(); await selection.dispose();
	assert.equal(events.filter(event => event === 'release:selected').length, 1);
	assert.ok(events.includes('release-output'));
});

test('cancelled native-copy save does no repair and retains the input for editing recovery', async () => {
	const { selection, events } = fixture(true);
	await selection.choose();
	assert.equal(await selection.saveCopy(), false);
	assert.equal(events.includes('repair-native-copy'), false);
	await selection.recover(async (file, options) => { assert.equal(file.name, 'unsaved.aup4unsaved'); assert.equal(options.recover, true); });
	await selection.dispose();
});

test('failed inspection preserves the source failure and disposes its worker without deleting an unopened database', async () => {
	const { selection, events } = fixture(false, true);
	await selection.choose();
	await assert.rejects(selection.inspect(), /Source read failed/u);
	assert.equal(events.includes('delete'), false);
	assert.equal(events.includes('dispose-worker'), true);
	await selection.dispose();
});

test('cancelling while the recovery client loads disposes it without opening the project', async () => {
	const { files } = fixture();
	const events: string[] = [];
	const client = {
		openFile: async () => { events.push('open'); },
		call: async () => null,
		dispose: () => { events.push('dispose'); },
	};
	const requested = Promise.withResolvers<void>();
	const supplied = Promise.withResolvers<typeof client>();
	const selection = createAudacityRecoverySelection(files, () => { requested.resolve(); return supplied.promise; });
	await selection.setFile(new File(['project'], 'cancelled.aup4'));
	const inspected = assert.rejects(selection.inspect(), { name: 'AbortError' });
	await requested.promise;
	await selection.dispose();
	supplied.resolve(client);
	await inspected;
	assert.deepEqual(events, ['dispose']);
});
