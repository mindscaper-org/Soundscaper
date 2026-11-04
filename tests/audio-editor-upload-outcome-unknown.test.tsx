/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createAudiocomApiClient } from '../src/common/editor/controller/import/internal/audiocom-api-client.ts';
import { createAudiocomUploadQueue } from '../src/common/editor/controller/import/internal/audiocom-upload-queue.ts';
import { createFreesoundApiClient, createFreesoundClientTransport } from '../src/common/editor/ui/workspace/freesound-auth-upload-client.ts';
import { createFreesoundUploadQueue } from '../src/common/editor/ui/workspace/freesound-upload-queue.ts';
import { OnlineMutationOutcomeUnknownError } from '../src/common/editor/online-request-recovery.ts';
import { uploadValidationFailure } from '../src/common/editor/upload-validation-failure.ts';
import AudiocomUploadArea from '../src/common/editor/ui/workspace/AudiocomUploadArea.tsx';
import FreesoundUploadArea from '../src/common/editor/ui/workspace/FreesoundUploadArea.tsx';
import { AUDIOCOM_COPY_BY_LOCALE } from '../src/common/i18n/audiocom-copy.ts';
import { FREESOUND_ATTRIBUTION_ENGLISH_COPY } from '../src/common/i18n/freesound-attribution-copy.js';

Object.assign(globalThis, { React });
const file = () => new File(['wave'], 'Voice.wav', { type: 'audio/wav' });
const localized = 'Der Server könnte den Vorgang erhalten haben. Vor erneutem Senden aktualisieren.';
const audioDraft = { title: 'Voice', description: '', category: 'recording', license: 'arr', visibility: 'unlisted' as const, downloadable: false, rightsConfirmed: true };

test('lost audio.com upload acknowledgement reaches the actual row through structured localized metadata', async () => {
	let mutations = 0;
	const client = createAudiocomApiClient({ location: { origin: 'https://soundscaper.org', protocol: 'https:' }, fetch: async input => {
		if (String(input).endsWith('/usage')) return Response.json({ data: {} });
		mutations += 1; throw new TypeError('private socket diagnostic');
	} });
	const queue = createAudiocomUploadQueue(client, () => true, () => undefined, () => undefined);
	try {
		const [id] = queue.enqueueFiles([file()]); assert.ok(id); await queue.publish(id, audioDraft);
		assert.equal(mutations, 1); assert.equal(queue.snapshot().items[0]?.uploadFailure?.reason, 'outcomeUnknown');
		for (const message of [undefined, localized]) {
			const copy = { ...AUDIOCOM_COPY_BY_LOCALE.en, ...(message ? { uploadValidationOutcomeUnknown: message } : {}) };
			const html = renderToStaticMarkup(<AudiocomUploadArea copy={copy} disabled={false} queue={queue.snapshot()} onFiles={() => undefined} onPublish={() => undefined} onRetry={() => undefined} onCancel={() => undefined} onRemove={() => undefined} />);
			assert.ok(message ? html.includes(message) : /may have received.*refresh/iu.test(html));
			assert.ok(!html.includes('private socket diagnostic'));
		}
	} finally { queue.dispose(); }
});

for (const stage of ['upload', 'publish'] as const) test(`lost Freesound ${stage} acknowledgement retains localized unknown-outcome feedback`, async () => {
	let mutations = 0;
	const client = createFreesoundApiClient(createFreesoundClientTransport({ location: { origin: 'https://soundscaper.org', protocol: 'https:' }, fetch: async input => {
		mutations += 1;
		if (stage === 'publish' && !String(input).endsWith('/describe')) return Response.json({ data: { uploadFilename: 'remote.wav' } });
		throw new TypeError('private socket diagnostic');
	} }));
	const queue = createFreesoundUploadQueue({ upload: client.upload, describe: client.describe });
	try {
		const [id] = queue.enqueueFiles([file()]); assert.ok(id);
		for (let attempt = 0; queue.getSnapshot().active && attempt < 20; attempt += 1) await new Promise<void>(resolve => setImmediate(resolve));
		if (stage === 'publish') await assert.rejects(queue.publish(id, {
			title: 'Voice', description: 'Field recording', tags: ['voice', 'field', 'recording'], categoryId: 'ss-n', license: 'cc-by', rightsConfirmed: true,
		}), OnlineMutationOutcomeUnknownError);
		assert.equal(mutations, stage === 'publish' ? 2 : 1);
		assert.equal(queue.getSnapshot().items[0]?.uploadFailure?.reason, 'outcomeUnknown');
		const html = renderToStaticMarkup(<FreesoundUploadArea copy={{ ...FREESOUND_ATTRIBUTION_ENGLISH_COPY, uploadValidationOutcomeUnknown: localized }} queue={queue.getSnapshot()} />);
		assert.ok(html.includes(localized)); assert.ok(!html.includes('private socket diagnostic'));
	} finally { queue.clear(); }
});

test('unknown outcome errors expose typed presentation metadata while preserving the diagnostic cause and HTTP status', () => {
	const cause = new Error('lost acknowledgement');
	const error = new OnlineMutationOutcomeUnknownError(cause, 504);
	assert.equal(error.cause, cause); assert.equal(error.status, 504);
	assert.deepEqual(uploadValidationFailure(error), { reason: 'outcomeUnknown', parameters: {} });
});

for (const provider of ['audiocom', 'freesound'] as const) test(`${provider} gateway responses warn of an unknown outcome without replaying the mutation`, async () => {
	for (const status of [408, 500, 502, 503, 504, 401, 403, 413, 422]) {
		let mutations = 0;
		const transport: typeof fetch = async input => {
			if (String(input).endsWith('/usage')) return Response.json({ data: {} });
			mutations += 1; return Response.json({ error: { message: 'owned server rejection' } }, { status });
		};
		const location = { origin: 'https://soundscaper.org', protocol: 'https:' };
		const client = provider === 'audiocom' ? createAudiocomApiClient({ fetch: transport, location })
			: createFreesoundApiClient(createFreesoundClientTransport({ fetch: transport, location }));
		const operation = provider === 'audiocom'
			? (client as ReturnType<typeof createAudiocomApiClient>).upload(file(), audioDraft)
			: (client as ReturnType<typeof createFreesoundApiClient>).upload(file());
		await assert.rejects(operation, error => {
			assert.ok(error instanceof Error && 'status' in error); assert.equal(error.status, status);
			assert.equal(error instanceof OnlineMutationOutcomeUnknownError, [408, 500, 502, 503, 504].includes(status));
			return true;
		});
		assert.equal(mutations, 1);
	}
});

for (const stage of ['audiocom-upload', 'freesound-upload', 'freesound-publish'] as const) test(`${stage} cannot claim failure certainty for a malformed success acknowledgement`, async () => {
	for (const body of ['not-json', JSON.stringify({ data: {} })]) {
		let mutations = 0;
		const transport: typeof fetch = async input => {
			if (String(input).endsWith('/usage')) return Response.json({ data: {} });
			mutations += 1; return new Response(body, { status: 201, headers: { 'Content-Type': 'application/json' } });
		};
		const location = { origin: 'https://soundscaper.org', protocol: 'https:' };
		const freesound = createFreesoundApiClient(createFreesoundClientTransport({ fetch: transport, location }));
		const operation = stage === 'audiocom-upload' ? createAudiocomApiClient({ fetch: transport, location }).upload(file(), audioDraft)
			: stage === 'freesound-upload' ? freesound.upload(file()) : freesound.describe({
				uploadFilename: 'remote.wav', title: 'Voice', description: '', tags: ['one', 'two', 'three'], categoryId: 'ss-n', license: 'cc-by',
			});
		await assert.rejects(operation, error => error instanceof OnlineMutationOutcomeUnknownError && error.status === 201);
		assert.equal(mutations, 1);
	}
});

test('native cloud project save preserves unknown-outcome metadata through the localized primary archive alert', async () => {
	const { createAudiocomProjectArchives } = await import('../src/common/editor/controller/import/audiocom-project-archives.ts');
	const { createRecoveringOnlineFetch } = await import('../src/common/editor/online-request-recovery.ts');
	const { default: AudiocomPanel } = await import('../src/common/editor/ui/workspace/AudiocomPanel.tsx');
	let mutations = 0;
	const request = createRecoveringOnlineFetch(async () => { mutations += 1; throw new TypeError('private archive network diagnostic'); });
	const archives = createAudiocomProjectArchives({ revisionStorage: null, client: {
		capabilities: async () => ({ formats: ['aup3'], maximumBytes: 1_000_000 }),
		list: async page => ({ results: [], page, hasNext: false }),
		upload: async () => { await request('https://soundscaper.org/api/audiocom/projects?phase=complete', { method: 'POST' }); throw new Error('unreachable'); },
	} });
	try {
		await archives.setConnected(true);
		await archives.saveProject('local-project', async () => new File(['SQLite format 3\0', new Uint8Array(16)], 'Session.aup3'));
		assert.equal(mutations, 1); assert.equal(archives.getSnapshot().requestFailure?.reason, 'outcome-unknown');
		const noop = () => undefined;
		const state = { auth: { status: 'connected' as const }, search: { query: '', page: 1, hasNext: false, results: [], status: 'idle' as const }, uploadQueue: { items: [], active: false }, previewingId: null };
		for (const message of [undefined, localized]) {
			const copy = { ...AUDIOCOM_COPY_BY_LOCALE.en, ...(message ? { uploadValidationOutcomeUnknown: message } : {}) };
			const html = renderToStaticMarkup(<AudiocomPanel state={state} archives={{ state: archives.getSnapshot(), onRefresh: noop, onCancel: noop }} copy={copy} onSearch={noop} onPreview={noop} onStopPreview={noop} onConnect={noop} onDisconnect={noop} onUploadFiles={noop} onPublish={noop} onRetry={noop} onCancel={noop} onRemove={noop} />);
			assert.ok(message ? html.includes(message) : /may have received.*refresh/iu.test(html));
			assert.ok(!html.includes('private archive network diagnostic'));
		}
		await archives.saveProject('local-project', async () => new File([new Uint8Array(32)], 'invalid.aup3'));
		assert.equal(archives.getSnapshot().requestFailure?.reason, 'archive-invalid'); assert.equal(mutations, 1);
	} finally { archives.dispose(); }
});
