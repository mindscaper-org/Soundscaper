/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { FreesoundPanelContainer } from '../src/common/editor/ui/workspace/FreesoundPanelContainer.tsx';
import {
	createAudiocomPanelSession, type AudiocomApiClient, type AudiocomSearchPage,
} from '../src/common/editor/controller/import/audiocom-panel-session.ts';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

const SOUND = {
	id: 42, name: 'Rain.ogg', pageUrl: 'https://freesound.org/s/42/',
	creator: { username: 'recorder', pageUrl: 'https://freesound.org/people/recorder/' },
	description: '', tags: [], category: null, subcategory: null,
	createdAt: '2026-01-02T03:04:05Z', generativeAiPreference: null, explicit: false,
	license: { code: 'cc0', name: 'Creative Commons 0', url: 'https://creativecommons.org/publicdomain/zero/1.0/',
		requiresAttribution: false, commercialUseAllowed: true },
	durationSeconds: 12, originalFile: { format: 'wav', channels: 1, byteLength: 1_152_044,
		sampleRate: 48_000, md5: '0123456789abcdef0123456789abcdef' },
	statistics: { downloads: 42, averageRating: 4.75, ratingCount: 8 },
	preview: { available: true, format: 'ogg', quality: 'high', approximateBitrateKbps: 192 },
};

function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (error: Error) => void;
	const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
	return { promise, resolve, reject };
}

class PreviewAudio extends EventTarget {
	src: string;
	volume = 1;
	preload = '';
	currentTime = 0;
	paused = true;
	constructor(source = '') { super(); this.src = source; }
	play(): Promise<void> { this.paused = false; return Promise.resolve(); }
	pause(): void { this.paused = true; }
	load(): void {}
}

for (const outcome of ['replace', 'failure', 'stale'] as const) {
	test(`Freesound ${outcome} search retains preview ownership through visible results`, async () => {
		const dom = installReactTestDom();
		const environment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
		const previous = { audio: globalThis.Audio, fetch: globalThis.fetch, act: environment.IS_REACT_ACT_ENVIRONMENT };
		environment.IS_REACT_ACT_ENVIRONMENT = true;
		const pending = deferred<Response>();
		const audio: PreviewAudio[] = [];
		let requests = 0;
		const page = (id = 42) => Response.json({ data: {
			query: 'rain', page: 1, pageSize: 20, totalCount: 1, totalPages: 1,
			hasNextPage: false, hasPreviousPage: false, results: [{ ...SOUND, id }],
		} });
		globalThis.fetch = () => ++requests === 2 ? pending.promise : Promise.resolve(page());
		globalThis.Audio = class extends PreviewAudio {
			constructor(source?: string) { super(source); audio.push(this); }
		} as unknown as typeof Audio;
		const { createRoot } = await import('react-dom/client');
		const root = createRoot(dom.container as unknown as Element);
		const token = { projectId: 'project-a', generation: 1 };
		const props = {
			controller: {
				actions: { project: { importFiles: async () => undefined } },
				getSnapshot: () => ({ productId: 'soundscaper', readOnly: false, importing: false, project: { id: 'project-a' } }),
				captureProjectGeneration: () => token, assertProjectGeneration: () => undefined,
			},
			snapshot: { locale: 'en', project: { tracks: [] } }, copy: ENGLISH_COPY,
			freesoundTransport: { request: async () => Response.json({ data: { connected: false } }), openAuthorization: () => undefined },
		};
		const submit = async () => {
			await act(async () => { reactProps(dom.one('form')).onSubmit({ preventDefault() {} }); });
		};
		const play = async () => {
			const button = dom.container.querySelectorAll('button').find(value => value.getAttribute('aria-label') === 'Play preview: Rain.ogg');
			assert.ok(button);
			assert.equal(button.disabled, false, 'the visible previous result can still be auditioned');
			await act(async () => { reactProps(button).onClick(); });
		};
		try {
			await act(async () => root.render(<FreesoundPanelContainer {...props} panelActive />));
			await act(async () => { reactProps(dom.one('input')).onChange({ currentTarget: { value: 'rain' } }); });
			await submit();
			await submit();
			await play();
			assert.equal(audio[0]?.paused, false);
			if (outcome === 'stale') {
				await submit();
				await play();
			}
			await act(async () => {
				if (outcome === 'failure') pending.reject(new Error('Search unavailable'));
				else pending.resolve(page(43));
			});
			if (outcome === 'replace') {
				assert.equal(audio[0]?.paused, true, 'retired results cannot keep playing without their controls');
				assert.equal(audio[0]?.src, '');
			} else {
				assert.equal(audio.at(-1)?.paused, false, 'failed or stale responses cannot stop the still-visible preview');
				assert.ok(dom.container.querySelectorAll('button').find(value => value.getAttribute('aria-label') === 'Pause preview: Rain.ogg'));
			}
		} finally {
			pending.resolve(page());
			await act(async () => root.unmount());
			globalThis.Audio = previous.audio; globalThis.fetch = previous.fetch;
			environment.IS_REACT_ACT_ENVIRONMENT = previous.act;
			dom.restore();
		}
	});
}

for (const outcome of ['replace', 'failure', 'stale'] as const) {
	test(`audio.com ${outcome} search retains preview ownership through visible results`, async () => {
		const result = { id: '42', title: 'Rain', authorName: 'Recorder', username: 'recorder',
			url: 'https://audio.com/recorder/audio/rain', description: '', license: 'arr',
			isDownloadable: false, durationSeconds: 12, previewUrl: 'https://audio.com/rain.mp3' };
		const pending = deferred<AudiocomSearchPage>();
		let requests = 0;
		let releases = 0;
		const audio: PreviewAudio[] = [];
		const client: AudiocomApiClient = {
			session: async () => ({ connected: true }), disconnect: async () => undefined,
			startOAuth: async () => { throw new Error('Already connected'); }, pollOAuth: async () => null,
			reserveAuthorization: () => ({ open() {}, close() {} }),
			search: () => ++requests === 2 ? pending.promise : Promise.resolve({ results: [result], page: 1, hasNext: false }),
			upload: async () => { throw new Error('No upload requested'); },
		};
		const session = createAudiocomPanelSession({ client,
			createAudio: () => { const value = new PreviewAudio(); audio.push(value); return value; },
			preparePreview: async () => ({ url: 'blob:rain', dispose() { releases++; } }),
		});
		try {
			await session.initialize();
			await session.search({ query: 'rain', page: 1 });
			const searching = session.search({ query: 'wind', page: 1 });
			await session.preview(result.id);
			assert.equal(audio[0]?.paused, false);
			if (outcome === 'stale') {
				await session.search({ query: 'birds', page: 1 });
				await session.preview(result.id);
			}
			if (outcome === 'failure') pending.reject(new Error('Search unavailable'));
			else pending.resolve({ results: [{ ...result, id: '43' }], page: 1, hasNext: false });
			await searching;
			if (outcome === 'replace') {
				assert.equal(audio[0]?.paused, true, 'the old result has no remaining preview control');
				assert.equal(audio[0]?.src, '');
				assert.equal(releases, 1);
				assert.equal(session.getSnapshot().previewingId, null);
			} else {
				assert.equal(audio.at(-1)?.paused, false);
				assert.equal(session.getSnapshot().previewingId, result.id);
			}
		} finally { session.dispose(); }
	});
}
