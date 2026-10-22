/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import FreesoundUploadArea from '../src/common/editor/ui/workspace/FreesoundUploadArea.tsx';
import { createFreesoundUploadQueue } from '../src/common/editor/ui/workspace/freesound-upload-queue.ts';
import { encodeWav } from '../src/common/editor/wav.js';
import { FREESOUND_ATTRIBUTION_COPY_BY_LOCALE } from '../src/common/i18n/freesound-attribution-copy.js';
import { installResponsivenessTestDom } from './helpers/responsiveness-round4-ui-dom.ts';
import { reactProps } from './helpers/react-test-dom.ts';

test('an unpublished Freesound upload can leave a full queue without publishing it', async () => {
	let descriptions = 0;
	const queue = createFreesoundUploadQueue({
		async upload() { return { uploadFilename: 'replacement.wav' }; },
		async describe() { descriptions++; return { status: 'pending_moderation' }; },
	});
	queue.restorePending(Array.from({ length: 100 }, (_, index) => ({
		uploadFilename: `unpublished-${index}.wav`, status: 'pending_description' as const,
	})));
	const dom = installResponsivenessTestDom();
	const root = createRoot(dom.container as unknown as Element);
	const render = () => root.render(<FreesoundUploadArea copy={FREESOUND_ATTRIBUTION_COPY_BY_LOCALE.en}
		queue={queue.getSnapshot()} onRemove={queue.remove} />);
	const unsubscribe = queue.subscribe(render);
	try {
		await act(async () => { render(); });
		const first = dom.container.querySelectorAll('li')[0];
		assert.ok(first);
		const remove = first.querySelectorAll('button').find(node => node.textContent.startsWith('Remove'));
		assert.ok(remove, 'an awaiting-description row needs the existing Remove action');
		await act(async () => { reactProps(remove).onClick({}); });
		assert.equal(queue.getSnapshot().items.length, 99);
		assert.equal(descriptions, 0, 'removing a local row must not publish its sound');
		const pcm = encodeWav([new Float32Array([0, 0.25, -0.25, 0])], { sampleRate: 48_000 });
		await act(async () => { queue.enqueueFiles([new File([Uint8Array.from(pcm).buffer], 'replacement.wav', { type: 'audio/wav' })]); });
		assert.equal(queue.getSnapshot().items.length, 100);
		assert.ok(queue.getSnapshot().items.some(item => item.fileName === 'replacement.wav'));
	} finally {
		unsubscribe();
		await act(async () => { root.unmount(); queue.clear(); });
		dom.restore();
	}
});
