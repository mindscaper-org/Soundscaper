/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createMotionSaveReplacementPort } from '../desktop/motionscaper-native-file-replacement.ts';
import type { MotionSaveReplacementInput } from '../desktop/motion-save-file-replacement.ts';

const input: MotionSaveReplacementInput = {
	source: 'C:\\selected\\.candidate.tmp', destination: 'C:\\selected\\saved.mscape',
	parent: { dev: '2731094893', ino: '13510798887756415' },
	candidate: { dev: '2731094893', ino: '17169973583882991', size: 12, mtimeMs: 1, ctimeMs: 2 },
	expected: { dev: '2731094893', ino: '17169973583882990', size: 24, mtimeMs: 3, ctimeMs: 4 },
};
const receipt = JSON.stringify({ productId: 'motionscaper', helperContractVersion: 1, operation: 'replace-file' });

test('native replacement revalidates its executable before passing exact lossless filesystem grants', async () => {
	const events: string[] = []; let arguments_: readonly string[] = [];
	const replace = createMotionSaveReplacementPort({
		async verify() { events.push('verify'); },
		execute: args => { events.push('execute'); arguments_ = args; return Promise.resolve(receipt); },
	});
	await replace(input);
	assert.deepEqual(events, ['verify', 'execute']);
	assert.deepEqual(arguments_, ['--replace-file-v1', input.source, input.destination, '2731094893', '13510798887756415',
		'2731094893', '17169973583882991', '2731094893', '17169973583882990']);
	await replace({ ...input, expected: null }); assert.deepEqual(arguments_.slice(-2), ['-', '-']);
});

test('a changed executable refuses replacement before any native invocation', async () => {
	let invoked = false;
	const replace = createMotionSaveReplacementPort({
		verify: () => Promise.reject(new Error('Executable digest changed')),
		execute: () => { invoked = true; return Promise.resolve(receipt); },
	});
	await assert.rejects(replace(input), /Executable digest changed/u); assert.equal(invoked, false);
});

test('replacement refuses path aliases, another selected parent and unsafe identities before invoking its helper', async () => {
	let invoked = false;
	const replace = createMotionSaveReplacementPort({ verify: () => Promise.resolve(), execute: () => { invoked = true; return Promise.resolve(receipt); } });
	for (const change of [
		{ source: 'relative.tmp' }, { source: 'C:\\other\\candidate.tmp' }, { source: 'c:\\selected\\SAVED.MSCAPE' },
		{ parent: { dev: '1', ino: '018' } }, { parent: { dev: '1', ino: '18446744073709551616' } },
	]) await assert.rejects(replace({ ...input, ...change }));
	assert.equal(invoked, false);
});

for (const value of [null, [], {}, { productId: 'framescaper', helperContractVersion: 1, operation: 'replace-file' },
	{ productId: 'motionscaper', helperContractVersion: 2, operation: 'replace-file' },
	{ productId: 'motionscaper', helperContractVersion: 1, operation: 'prores-4444' },
	{ productId: 'motionscaper', helperContractVersion: 1, operation: 'replace-file', accepted: true }]) {
	test(`replacement refuses an incomplete or foreign native receipt: ${JSON.stringify(value)}`, async () => {
		const replace = createMotionSaveReplacementPort({ verify: () => Promise.resolve(), execute: () => Promise.resolve(JSON.stringify(value)) });
		await assert.rejects(replace(input), /receipt is invalid/u);
	});
}

test('a native replacement failure propagates without a second filesystem operation', async () => {
	let calls = 0;
	const replace = createMotionSaveReplacementPort({ verify: () => Promise.resolve(), execute: () => { calls++; return Promise.reject(new Error('Native identity mismatch')); } });
	await assert.rejects(replace(input), /Native identity mismatch/u); assert.equal(calls, 1);
});
