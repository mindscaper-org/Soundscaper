/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { runMacroFileBatch } from '../src/common/editor/controller/effects/macro-file-batch-service.ts';

test('batch macros use isolated sequential sessions, continue after failure and dispose every session', async () => {
	const events: string[] = [];
	const result = await runMacroFileBatch({
		createSession: async (input: { name: string }) => {
			events.push(`open:${input.name}`);
			return {
				run: async () => { events.push(`run:${input.name}`); if (input.name === 'broken.wav') throw new Error('Bad input'); },
				export: async () => { events.push(`export:${input.name}`); },
				dispose: async () => { events.push(`dispose:${input.name}`); },
			};
		},
	}, { macro: { kind: 'steps', name: 'Normalize', effects: [{ type: 'audacity-normalize' }] },
		items: ['one.wav', 'broken.wav', 'three.wav'].map(name => ({ input: { name }, target: { id: name, name } })),
		format: 'wav', signal: new AbortController().signal,
	});
	assert.deepEqual(events, ['open:one.wav', 'run:one.wav', 'export:one.wav', 'dispose:one.wav',
		'open:broken.wav', 'run:broken.wav', 'dispose:broken.wav', 'open:three.wav', 'run:three.wav', 'export:three.wav', 'dispose:three.wav']);
	assert.deepEqual(result.map(row => row.status), ['completed', 'failed', 'completed']);
	assert.equal(result[1]?.message, 'Bad input');
});

test('batch cancellation stops before export and does not open subsequent files', async () => {
	const cancellation = new AbortController(), events: string[] = [];
	const result = await runMacroFileBatch({ createSession: async () => ({
		run: async () => { cancellation.abort(new DOMException('Cancelled', 'AbortError')); },
		export: async () => { events.push('export'); }, dispose: async () => { events.push('dispose'); },
	}) }, { macro: { kind: 'script', name: 'Test', source: 'await sound.select.all();' }, format: 'wav', signal: cancellation.signal,
		items: ['one', 'two'].map(name => ({ input: { name }, target: { id: name, name } })),
	});
	assert.deepEqual(events, ['dispose']);
	assert.deepEqual(result.map(row => row.status), ['cancelled', 'skipped']);
});
