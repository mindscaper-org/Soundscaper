/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';

import { createAudiocomUploadQueue } from '../src/common/editor/controller/import/internal/audiocom-upload-queue.ts';
import type { AudiocomApiClient, AudiocomUploadDraft } from '../src/common/editor/controller/import/audiocom-panel-session.ts';
import AudiocomPublishDialog from '../src/common/editor/ui/workspace/AudiocomPublishDialog.tsx';
import { AUDIOCOM_COPY_BY_LOCALE } from '../src/common/i18n/audiocom-copy.ts';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

for (const name of [`${'a'.repeat(199)}😀tail.wav`, '.wav']) {
	test(`audio.com file ${name.length > 20 ? 'with a long name' : 'without a stem'} has immediately usable publication defaults`, async () => {
		const submissions: AudiocomUploadDraft[] = [];
		const queue = createAudiocomUploadQueue(client(submissions), () => true, () => undefined, () => undefined);
		queue.enqueueFiles([new File(['RIFF'], name, { type: 'audio/wav' })]);
		const item = queue.snapshot().items[0];
		assert.ok(item);
		const dom = installReactTestDom();
		const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
		const previousAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
		actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
		const { createRoot } = await import('react-dom/client');
		const root = createRoot(dom.container as unknown as Element);
		let closes = 0;
		try {
			await act(async () => root.render(<AudiocomPublishDialog copy={AUDIOCOM_COPY_BY_LOCALE.en} item={item}
				onPublish={queue.publish} onClose={() => { closes += 1; }} />));
			const consent = dom.container.querySelectorAll('input').find(input => input.name === 'rightsConfirmed');
			assert.ok(consent);
			await act(async () => reactProps(consent).onChange({ currentTarget: { checked: true } }));
			await act(async () => reactProps(dom.one('form')).onSubmit({ preventDefault() {} }));
			assert.equal(submissions.length, 1, 'the default title must pass the real upload queue admission');
			assert.ok(submissions[0]?.title.trim());
			assert.ok(submissions[0]!.title.length <= 200);
			assert.equal(submissions[0]!.title.isWellFormed(), true);
			assert.equal(closes, 1);
		} finally {
			queue.dispose();
			await act(async () => root.unmount());
			actGlobal.IS_REACT_ACT_ENVIRONMENT = previousAct;
			dom.restore();
		}
	});
}

function client(submissions: AudiocomUploadDraft[]): AudiocomApiClient {
	return {
		session: async () => ({ connected: true }), disconnect: async () => undefined,
		startOAuth: async () => { throw new Error('This local fixture cannot authorize.'); },
		pollOAuth: async () => null, reserveAuthorization: () => ({ open() {}, close() {} }),
		search: async () => ({ results: [], page: 1, hasNext: false }),
		upload: async (_file, draft) => {
			submissions.push(draft);
			return { processing: false, audio: { id: '123', title: draft.title, authorName: '', username: 'recorder',
				url: 'https://audio.com/recorder/audio/take', description: '', license: 'arr', isDownloadable: false, durationSeconds: 1 } };
		},
	};
}
