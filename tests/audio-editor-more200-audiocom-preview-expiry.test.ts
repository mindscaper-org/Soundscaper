/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createAudiocomPanelSession } from '../src/common/editor/controller/import/audiocom-panel-session.ts';
import { AudiocomApiError, createAudiocomApiClient } from '../src/common/editor/controller/import/internal/audiocom-api-client.ts';
import { prepareAudiocomPreview } from '../src/common/editor/controller/import/internal/audiocom-original-preview.ts';

const result = { id: '123', title: 'Session recording', authorName: 'Recorder', username: 'recorder',
	url: 'https://audio.com/recorder/audio/recording', description: '', license: 'arr', isDownloadable: false,
	durationSeconds: 1, previewUrl: '/api/audiocom/preview?url=https%3A%2F%2Faudio.com%2Frecording.aiff', previewMime: 'audio/aiff' };

for (const status of [401, 500]) test(`a downloaded original preview HTTP${status} preserves its authorization status`, async () => {
	await assert.rejects(prepareAudiocomPreview(result, new AbortController().signal, {
		fetch: async () => new Response('unavailable', { status }),
	}), (error: unknown) => { assert.ok(error instanceof AudiocomApiError); assert.equal(error.status, status); return true; });
});

for (const status of [401, 500]) test(`the actual account session settles original preview HTTP${status}`, async context => {
	const requests: string[] = [];
	const fetch: typeof globalThis.fetch = async input => {
		const url = String(input); requests.push(new URL(url).pathname);
		if (url.includes('/preview?')) return new Response('unavailable', { status });
		const data = url.includes('/oauth/session') ? { connected: true }
			: url.includes('/search?') ? { results: [result], page: 1, hasNext: false }
				: { provider: { kind: 'audiocom', apiOrigin: 'https://api.audio.com', webOrigin: 'https://audio.com', scope: 'all', projectStorageSupported: false } };
		return Response.json({ data });
	};
	const client = createAudiocomApiClient({ fetch, location: { origin: 'https://soundscaper.org', protocol: 'https:' } });
	const session = createAudiocomPanelSession({ client,
		preparePreview: async (selected, signal) => await prepareAudiocomPreview(selected, signal, { fetch }),
		createAudio: () => { throw new Error('A rejected original cannot create audio.'); } });
	context.after(() => session.dispose());
	await session.initialize(); await session.search({ query: 'recording', page: 1 });
	session.enqueueFiles([new File(['RIFF'], 'next.wav', { type: 'audio/wav' })]);
	await session.preview(result.id);
	assert.equal(requests.at(-1), '/api/audiocom/preview');
	assert.equal(session.getSnapshot().auth.status, status === 401 ? 'disconnected' : 'connected');
	assert.equal(session.getSnapshot().uploadQueue.items.length, status === 401 ? 0 : 1);
	assert.equal(session.getSnapshot().previewingId, null);
	if (status === 401) assert.match(session.getSnapshot().auth.errorMessage ?? '', /session expired/u);
	else assert.match(session.getSnapshot().previewError ?? '', /could not be downloaded/u);
});

test('a retired original401 cannot disconnect the replacement preview', async context => {
	let release!: (response: Response) => void;
	const other = { ...result, id: '124', previewMime: 'audio/mpeg', previewUrl: 'https://soundscaper.org/api/audiocom/preview?url=next' };
	const client = createAudiocomApiClient({ location: { origin: 'https://soundscaper.org', protocol: 'https:' },
		fetch: async input => Response.json({ data: String(input).includes('/oauth/session') ? { connected: true }
			: String(input).includes('/search?') ? { results: [result, other], page: 1, hasNext: false } : {} }) });
	const audio = { src: '', volume: 1, pause() {}, load() {}, play: async () => undefined, addEventListener() {}, removeEventListener() {} };
	const session = createAudiocomPanelSession({ client, createAudio: () => audio,
		preparePreview: async (selected, signal) => await prepareAudiocomPreview(selected, signal, {
			fetch: async () => await new Promise<Response>(resolve => { release = resolve; }),
		}) });
	context.after(() => session.dispose());
	await session.initialize(); await session.search({ query: 'recording', page: 1 });
	const pending = session.preview(result.id); await session.preview(other.id);
	release(new Response('expired', { status: 401 })); await pending;
	assert.equal(session.getSnapshot().auth.status, 'connected');
	assert.equal(session.getSnapshot().previewingId, other.id);
	assert.equal(session.getSnapshot().previewError, undefined);
});
