/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createImportVideoFile } from '../src/common/editor/controller/import/internal/source-import.ts';
import type { ImportVideoFrameExtractor } from '../src/common/editor/controller/import/internal/source-import-types.d.ts';
import { createFixture, videoFile } from './helpers/audio-editor-source-import-fixture.ts';

type CaptureOptions = NonNullable<Parameters<ImportVideoFrameExtractor['capture']>[1]> & { readonly signal?: AbortSignal };
for (const phase of ['metadata', 'poster', 'thumbnail'] as const) test(`Cancellation retires a pending video ${phase} wait in its owning stage`, { timeout: 2000 }, async () => {
	const fixture = createFixture(), factory = fixture.runtime.createAudioEditorVideoFrameExtractor;
	const abort = new AbortController(), reason = new DOMException('Cancel video import.', 'AbortError');
	let notify: (() => void) | undefined, release: (() => void) | undefined, held = false;
	const entered = new Promise<void>(resolve => { notify = resolve; });
	const wait = (signal?: AbortSignal): Promise<void> => new Promise((resolve, reject) => {
		const onAbort = () => { signal?.removeEventListener('abort', onAbort); reject(signal?.reason); };
		release = () => { signal?.removeEventListener('abort', onAbort); resolve(); };
		signal?.addEventListener('abort', onAbort, { once: true }); notify?.();
	});
	fixture.runtime.createAudioEditorVideoFrameExtractor = async (file, options?: Readonly<{ signal?: AbortSignal }>) => {
		if (phase === 'metadata' && !held) { held = true; await wait(options?.signal); }
		const extractor = await factory(file); let captures = 0;
		return { ...extractor, async capture(timestamp, options?: CaptureOptions) {
			const matching = phase === 'poster' && captures === 0 || phase === 'thumbnail' && captures === 1;
			captures++; if (matching && !held) { held = true; await wait(options?.signal); }
			return extractor.capture(timestamp, options);
		} };
	};
	const importVideo = createImportVideoFile(fixture.runtime), status = { value: 'pending' };
	const operation = importVideo(videoFile(), { destination: 'timeline', trackId: null, timelineStartFrame: 0, signal: abort.signal });
	const observed = operation.then(() => { status.value = 'completed'; }, error => { status.value = error === reason ? 'aborted' : String(error); });
	try {
		await entered;
		if (phase === 'metadata') {
			abort.abort(reason); await observed;
			assert.equal(status.value, 'aborted');
			assert.equal(fixture.commits.length, 0); assert.equal(fixture.sourceBuffers.size, 0);
		} else {
			await observed;
			assert.equal(status.value, 'completed', 'Preview waits must not hold the importer.');
			fixture.lifetime.cancelScope('project', reason);
			await fixture.finishDerivatives();
			assert.equal(fixture.commits.length, 1); assert.equal(fixture.sourceBuffers.size, 1);
		}
		assert.deepEqual(fixture.deletedMedia, [], 'Preview cancellation never rolls back committed media.');
		await importVideo(videoFile('Fresh.mp4'), { destination: 'timeline', trackId: null, timelineStartFrame: 0 });
		assert.equal(fixture.commits.length, phase === 'metadata' ? 1 : 2);
	} finally { release?.(); await observed; await fixture.finishDerivatives(); }
});
