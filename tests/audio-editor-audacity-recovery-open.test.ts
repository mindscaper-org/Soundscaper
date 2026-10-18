/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { openAudacityWithRecovery } from '../src/common/editor/controller/document/internal/native-project/audacity-recovery-open.ts';

test('a damaged import retries the same untouched file once with recovery enabled', async () => {
	const calls: Array<{ id: string; file: Blob; recover?: boolean }> = [];
	const file = new Blob(['source']);
	const client = {
		async openFile(id: string, input: Blob, options: { readonly recover?: boolean }) {
			calls.push({ id, file: input, recover: options.recover });
			if (!options.recover) throw Object.assign(new Error('Missing sample block.'), { code: 'MISSING_SAMPLE_BLOCK' });
			return { readOnly: false };
		},
	};
	assert.deepEqual(await openAudacityWithRecovery(client, 'copy', file, {}), { readOnly: false });
	assert.equal(calls.length, 2);
	assert.equal(calls[0]?.file, file);
	assert.equal(calls[1]?.file, file);
	assert.equal(calls[1]?.recover, true);
});

test('unsafe schema, newer formats, cancellation, quota and size failures are never recovery retries', async () => {
	for (const code of ['UNSAFE_SCHEMA', 'UNSUPPORTED_SCHEMA', 'NEWER_DATABASE', 'ABORTED', 'QUOTA_EXCEEDED', 'PROJECT_TOO_LARGE']) {
		let calls = 0;
		const failure = Object.assign(new Error(code), { code });
		const client = { openFile() { calls += 1; return Promise.reject(failure); } };
		await assert.rejects(openAudacityWithRecovery(client, 'copy', new Blob(), {}), (error) => error === failure);
		assert.equal(calls, 1);
	}
});

test('explicit recovery runs once and preserves its actionable failed recovery diagnostic', async () => {
	let calls = 0;
	const failure = Object.assign(new Error('Keep the original and try Audacity Project Tools.'), { code: 'AUDACITY_RECOVERY_FAILED' });
	const client = { openFile(_id: string, _file: Blob, options: { readonly recover?: boolean }) {
		calls += 1; assert.equal(options.recover, true); return Promise.reject(failure);
	} };
	await assert.rejects(openAudacityWithRecovery(client, 'copy', new Blob(), { recover: true }), (error) => error === failure);
	assert.equal(calls, 1);
});
