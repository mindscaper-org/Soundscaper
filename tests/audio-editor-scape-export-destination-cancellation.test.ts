/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { exportScapeProject } from '../src/common/editor/scape-project.js';
import { createBaselineAudioEditorProject } from './helpers/baseline-scape-runtime.ts';
import { createMemoryProjectStore } from './helpers/memory-project-store.ts';

test('cancelling while opening an archive destination aborts the writer before it can publish', async context => {
	const project = createBaselineAudioEditorProject({ id: 'destination-cancelled', title: 'Cancelled destination' });
	const store = createMemoryProjectStore(context, 'scape-export-late-destination');
	const cancellation = new AbortController();
	const reason = new DOMException('Cancelled during destination creation', 'AbortError');
	const aborted: unknown[] = [];
	let writes = 0;
	let closes = 0;
	const destination = new WritableStream<Uint8Array>({
		write() { writes += 1; },
		close() { closes += 1; },
		abort(error: unknown) { aborted.push(error); },
	});
	await assert.rejects(exportScapeProject(project, store, {
		signal: cancellation.signal,
		createWritable: async () => {
			cancellation.abort(reason);
			return destination;
		},
	}), error => error === reason);
	assert.deepEqual(aborted, [reason]);
	assert.equal(writes, 0);
	assert.equal(closes, 0);
	assert.equal(destination.locked, false);
});
