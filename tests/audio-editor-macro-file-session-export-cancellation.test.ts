/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createSoundscaperMacroFileSession } from '../src/soundscaper/macro-file-session.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { deferred } from './helpers/async-test-control.ts';

type SessionOptions = Parameters<typeof createSoundscaperMacroFileSession>[1];

test('cancelling a macro batch while a save target is pending releases it without writing output', async context => {
	const cancellation = new AbortController();
	const started = deferred<void>();
	const target = deferred<Readonly<{ id: string; name: string }>>();
	const saveTarget = { id: 'save-id', name: 'Result.wav' };
	const events: string[] = [];
	const project = createSoundscaperProject({ tracks: [{ id: 'track', type: 'audio', clipIds: ['clip'] }],
		clips: [{ id: 'clip', sourceId: 'source', durationFrames: 16 }],
		sources: [{ id: 'source', sampleRate: 48_000, frameCount: 16, channelCount: 1 }] });
	const controller = {
		ready: Promise.resolve(), project,
		actions: {
			project: { importFiles() {} },
			timeline: { selectTrack() {}, setSelection() {} },
			macros: { cancel() {}, library: { save() {} } },
			export: {
				cancel() {},
				start() { events.push('write'); return { completed: true }; },
			},
		},
		dispose() {},
	} as unknown as ReturnType<SessionOptions['createController']>;
	const fileService = {
		withReadDescriptors: (_descriptors: unknown, _options: unknown, consume: (files: readonly File[]) => Promise<void>) => consume([]),
		prepareBatchSaveTarget: () => { started.resolve(); return target.promise; },
		releaseSaveTarget: (released: unknown) => { assert.deepEqual(released, saveTarget); events.push('release'); },
	} as unknown as SessionOptions['fileService'];
	const session = await createSoundscaperMacroFileSession({ id: 'input-id', name: 'Voice.wav' }, {
		createController: () => controller, fileService, savedMacros: [], signal: cancellation.signal,
	});
	context.after(async () => { await session.dispose(); });
	const pending = session.export({ batchId: 'batch-id', index: 0, name: saveTarget.name }, 'wav', cancellation.signal);
	await started.promise;
	const reason = new DOMException('Cancelled by the user', 'AbortError');
	cancellation.abort(reason);
	target.resolve(saveTarget);
	await assert.rejects(pending, error => error === reason);
	assert.deepEqual(events, ['release']);
});
