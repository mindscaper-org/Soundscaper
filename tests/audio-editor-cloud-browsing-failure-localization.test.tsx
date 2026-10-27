/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';
import { FreesoundPanelContainer } from '../src/common/editor/ui/workspace/FreesoundPanelContainer.tsx';
import { renderToStaticMarkup } from 'react-dom/server';
import { createAudiocomProjectArchives, type AudiocomProjectArchiveClient } from '../src/common/editor/controller/import/audiocom-project-archives.ts';
import { createAudiocomPanelSession, type AudiocomApiClient } from '../src/common/editor/controller/import/audiocom-panel-session.ts';
import AudiocomPanel, { type AudiocomPanelProps } from '../src/common/editor/ui/workspace/AudiocomPanel.tsx';
import FreesoundPanel, { type FreesoundPanelProps } from '../src/common/editor/ui/workspace/FreesoundPanel.tsx';
import { AUDIOCOM_COPY_BY_LOCALE } from '../src/common/i18n/audiocom-copy.ts';
import { FREESOUND_ATTRIBUTION_ENGLISH_COPY } from '../src/common/i18n/freesound-attribution-copy.js';
import { createFreesoundImportService } from '../src/common/editor/controller/import/freesound-import-service.ts';
import { AudiocomApiError } from '../src/common/editor/controller/import/internal/audiocom-api-client.ts';
import { onlineMediaFailure } from '../src/common/editor/online-media-failure.ts';
const noop = () => {};
const copy = { ...AUDIOCOM_COPY_BY_LOCALE.en, projectUploadCancelled: 'Abgebrochen. Cloud-Liste vor erneutem Speichern aktualisieren.',
	projectArchiveInvalid: 'Ungültige Projektdatei.', previewFailed: 'Vorschau konnte nicht abgespielt werden.' };
function renderPanel(state: AudiocomPanelProps['state'], archives?: AudiocomPanelProps['archives']): string {
	return renderToStaticMarkup(<AudiocomPanel state={state} archives={archives} copy={copy} onSearch={noop} onPreview={noop}
		onStopPreview={noop} onConnect={noop} onDisconnect={noop} onUploadFiles={noop} onPublish={noop} onRetry={noop} onCancel={noop} onRemove={noop} />);
}
const baseState = { auth: { status: 'connected' as const }, search: { query: '', page: 1, hasNext: false, results: [], status: 'idle' as const },
	uploadQueue: { items: [], active: false }, previewingId: null };

test('real cloud-project cancellation fences the late upload and renders localized primary archive feedback', async () => {
	let release!: (value: Awaited<ReturnType<AudiocomProjectArchiveClient['upload']>>) => void;
	let started!: () => void; const uploading = new Promise<void>((resolve) => { started = resolve; });
	const item = { id: 'cloud', name: 'Session', format: 'aup3' as const, size: 32, snapshotId: null };
	const client: AudiocomProjectArchiveClient = { capabilities: async () => ({ formats: ['aup3'], maximumBytes: 1000000 }),
		list: async () => ({ results: [], page: 1, hasNext: false }), upload: () => new Promise((resolve) => { release = resolve; started(); }) };
	const archives = createAudiocomProjectArchives({ client });
	try {
		await archives.setConnected(true);
		const saving = archives.saveProject('project', async () => new File(['SQLite format 3\0', new Uint8Array(16)], 'Session.aup3'));
		await uploading; archives.cancel(); release(item); await saving;
		const state = archives.getSnapshot();
		assert.match(state.errorMessage!, /cancelled/);
		const markup = renderPanel(baseState, { state, onRefresh: noop, onCancel: noop });
		assert.match(markup, /Abgebrochen\. Cloud-Liste/); assert.doesNotMatch(markup, /The upload was cancelled/);
		await archives.saveProject('project', async () => new File([new Uint8Array(32)], 'bad.aup3'));
		assert.match(renderPanel(baseState, { state: archives.getSnapshot(), onRefresh: noop, onCancel: noop }), /Ungültige Projektdatei/);
	} finally { archives.dispose(); }
});

test('actual audio.com preview media error renders translated feedback and releases owned playback', async () => {
	const result = { id: 'audio', title: 'Audio', authorName: '', username: 'user', url: 'https://audio.com/user/audio/example',
		description: '', license: 'arr', isDownloadable: false, durationSeconds: 1, previewUrl: '/preview' };
	const client: AudiocomApiClient = { session: async () => ({ connected: true }), disconnect: async () => {},
		startOAuth: async () => { throw new Error('unused'); }, pollOAuth: async () => null,
		reserveAuthorization: () => ({ open: noop, close: noop }), search: async () => ({ results: [result], page: 1, hasNext: false }),
		upload: async () => ({ audio: result, processing: false }) };
	const listeners = new Map<string, () => void>(); let released = 0;
	const session = createAudiocomPanelSession({ client, preparePreview: async () => ({ url: '/owned-preview', dispose: () => { released += 1; } }),
		createAudio: () => ({ src: '', volume: 1, play: async () => {}, pause: noop, load: noop,
			addEventListener: (type, listener) => { listeners.set(type, listener); }, removeEventListener: (type) => { listeners.delete(type); } }) });
	try {
		await session.initialize(); await session.search({ query: 'tone', page: 1 }); await session.preview('audio'); listeners.get('error')!();
		assert.equal(session.getSnapshot().previewingId, null); assert.equal(released, 1);
		const markup = renderPanel(session.getSnapshot());
		assert.match(markup, /Vorschau konnte nicht abgespielt werden/); assert.doesNotMatch(markup, /The audio.com preview could not be played/);
	} finally { session.dispose(); }
});

test('actual Freesound empty503 search carries authoritative status and renders translated service guidance', async () => {
	const service = createFreesoundImportService({ enabled: true, createContributionId: () => 'unused', importFile: async () => { throw new Error('search must not import'); }, fetch: async () => new Response(null, { status: 503 }) });
	let error: unknown; try { await service.search({ query: 'rain', page: 1, license: 'all', sort: 'relevance' }); } catch (failure) { error = failure; }
	assert.ok(error instanceof Error); assert.match(error.message, /503/);
	const state = { query: 'rain', license: 'all' as const, sort: 'relevance' as const, page: 1, pageCount: 0, totalResults: 0,
		status: 'error' as const, errorMessage: error.message, searchFailure: onlineMediaFailure('search', error),
		previewingSoundId: null, previewPaused: false, results: [] };
	const props = { state, disabled: false, copy: { ...FREESOUND_ATTRIBUTION_ENGLISH_COPY, searchRequestHttpFailed: 'Dienst meldet HTTP {status}. Später erneut suchen.' },
		onSearch: noop, onPreview: noop, onPausePreview: noop, onResumePreview: noop, onSeekPreview: noop,
		onInsertAtPlayhead: noop, onAddToProjectBin: noop } satisfies FreesoundPanelProps;
	const markup = renderToStaticMarkup(<FreesoundPanel {...props} />);
	assert.match(markup, /Dienst meldet HTTP 503/); assert.doesNotMatch(markup, /Freesound request failed/);
});


test('actual mounted Freesound search publishes typed503 feedback and re-renders its current locale', async () => {
	const dom = installReactTestDom(), previousFetch = globalThis.fetch;
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const previousAct = actGlobal.IS_REACT_ACT_ENVIRONMENT; actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	globalThis.fetch = async (input) => String(input).includes('/search') ? new Response(null, { status: 503 }) : Response.json({ data: { connected: false } });
	const { createRoot } = await import('react-dom/client'), root = createRoot(dom.container as unknown as Element);
	const controller = { actions: { project: { importFiles: async () => undefined } },
		getSnapshot: () => ({ productId: 'soundscaper', project: { id: 'project' } }),
		captureProjectGeneration: () => ({ projectId: 'project', generation: 1 }), assertProjectGeneration: noop };
	const props = { controller, snapshot: { locale: 'de', project: { tracks: [] } },
		copy: { 'ui.freesoundAttribution.searchRequestHttpFailed': 'Dienst meldet HTTP {status}. Später erneut suchen.' } };
	try {
		await act(async () => root.render(<FreesoundPanelContainer {...props} />));
		await act(async () => { reactProps(dom.one('input')).onChange({ currentTarget: { value: 'rain' } }); });
		await act(async () => { reactProps(dom.one('form')).onSubmit({ preventDefault() {} }); await Promise.resolve(); });
		assert.match(dom.container.textContent, /Dienst meldet HTTP 503/);
		assert.doesNotMatch(dom.container.textContent, /Freesound request failed/);
		await act(async () => root.render(<FreesoundPanelContainer {...props} copy={{ 'ui.freesoundAttribution.searchRequestHttpFailed': 'Service indisponible, HTTP {status}.' }} />));
		assert.match(dom.container.textContent, /Service indisponible, HTTP 503/);
	} finally { await act(async () => root.unmount()); globalThis.fetch = previousFetch; actGlobal.IS_REACT_ACT_ENVIRONMENT = previousAct; dom.restore(); }
});


test('audio.com search HTTP failures and authentication expiry keep status and diagnostics behind localized primary guidance', async () => {
	let status = 503;
	const client: AudiocomApiClient = { session: async () => ({ connected: true }), disconnect: async () => {},
		startOAuth: async () => { throw new Error('unused'); }, pollOAuth: async () => null,
		reserveAuthorization: () => ({ open: noop, close: noop }), search: async () => { throw new AudiocomApiError(status, 'Provider diagnostic body.'); },
		upload: async () => { throw new Error('unused'); } };
	const session = createAudiocomPanelSession({ client });
	try {
		await session.initialize(); await session.search({ query: 'tone', page: 1 });
		assert.equal(session.getSnapshot().search.requestFailure?.status, 503);
		assert.equal(session.getSnapshot().search.requestFailure?.diagnostic, 'Provider diagnostic body.');
		assert.doesNotMatch(renderPanel(session.getSnapshot()), /Provider diagnostic body/);
		status = 401; await session.search({ query: 'tone', page: 1 });
		assert.equal(session.getSnapshot().auth.requestFailure?.reason, 'connection-expired');
		assert.equal(session.getSnapshot().auth.status, 'disconnected');
		assert.doesNotMatch(renderPanel(session.getSnapshot()), /Provider diagnostic body/);
	} finally { session.dispose(); }
});
