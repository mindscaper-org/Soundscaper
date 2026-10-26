/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createImportVideoFile } from '../src/common/editor/controller/import/internal/source-import.ts';
import type { ImportVideoFrameExtractor } from '../src/common/editor/controller/import/internal/source-import-types.d.ts';
import { createFixture, videoFile } from './helpers/audio-editor-source-import-fixture.ts';

type CaptureOptions = NonNullable<Parameters<ImportVideoFrameExtractor['capture']>[1]> & { readonly signal?: AbortSignal };
for (const phase of ['metadata', 'poster', 'thumbnail'] as const) test(`Cancel retires a pending native video ${phase} wait before retry`, { timeout: 2000 }, async () => {
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
		await entered; abort.abort(reason); await new Promise<void>(resolve => setImmediate(resolve));
		assert.equal(status.value, 'aborted', 'Cancel must release the importer without waiting for the native callback.');
		assert.equal(fixture.commits.length, 0); assert.equal(fixture.sourceBuffers.size, 0);
		assert.equal(fixture.deletedMedia.length, phase === 'metadata' ? 0 : 1);
		await importVideo(videoFile('Fresh.mp4'), { destination: 'timeline', trackId: null, timelineStartFrame: 0 });
		assert.equal(fixture.commits.length, 1);
	} finally { release?.(); await observed; }
});
