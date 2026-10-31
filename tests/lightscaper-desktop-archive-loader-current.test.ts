/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { loadDesktopPhotoArchiveFileCurrentV1 } from '../src/lightscaper/desktop-photo-archive-loader-current-v1.ts';
import { deferred, settle } from './helpers/async-test-control.ts';

const id = 'a'.repeat(64), descriptor = { id, name: 'Owned.liscape', size: 3, lastModified: 0,
	url: `lightscaper-app://bundle/_desktop/read/scape-range-v1/${id}/Owned.liscape`,
	mimeType: 'application/vnd.soundscaper.scape+zip' as const, readProfile: 'scape-range-v1' as const };

test('Lightscaper lazy archive activation failure joins native grant retirement before rejecting', async () => {
	const primary = Object.freeze({ activation: 'unavailable' }), finish = deferred<void>();
	let released = 0, settled = false;
	const work = loadDesktopPhotoArchiveFileCurrentV1(descriptor, { loadRuntime: async () => { throw primary; },
		finishArchive: async request => { assert.deepEqual(request, { id }); released++; await finish.promise; } });
	void work.then(() => { settled = true; }, () => { settled = true; });
	await settle(); assert.equal(released, 1); assert.equal(settled, false);
	finish.resolve(); await assert.rejects(work, error => Object.is(error, primary));
});

test('Lightscaper failed lazy activation retains both primary and native retirement failures', async () => {
	const primary = Symbol('activation'), cleanup = Symbol('release');
	await assert.rejects(loadDesktopPhotoArchiveFileCurrentV1(descriptor, {
		loadRuntime: async () => { throw primary; }, finishArchive: async () => { throw cleanup; },
	}), error => { assert.ok(error instanceof AggregateError); assert.deepEqual(error.errors, [primary, cleanup]); return true; });
});

test('Lightscaper activated materializer owns the only grant release and receives the exact cancellation signal', async () => {
	const stop = new AbortController(), file = new File(['one'], descriptor.name); let finishes = 0;
	const result = await loadDesktopPhotoArchiveFileCurrentV1(descriptor, {
		signal: stop.signal, finishArchive: async () => { finishes++; },
		loadRuntime: async () => ({ materializeDesktopPhotoArchiveFileCurrentV1: async (value, options) => {
			assert.equal(value, descriptor); assert.equal(options.signal, stop.signal);
			await options.finishArchive({ id }); return { file, close: async () => undefined };
		} }),
	});
	assert.equal(result.file, file); assert.equal(finishes, 1); await result.close();
});
