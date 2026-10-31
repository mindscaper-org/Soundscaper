/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { FreesoundPanelContainer } from '../src/common/editor/ui/workspace/FreesoundPanelContainer.tsx';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

const SOUND = {
	id: 42, name: 'Rain.ogg', creator: { username: 'field-recorder', pageUrl: 'https://freesound.org/people/field-recorder/' },
	pageUrl: 'https://freesound.org/s/42/', description: 'A rain recording.', tags: ['rain'], category: null, subcategory: null,
	createdAt: '2026-01-02T03:04:05Z', generativeAiPreference: null, explicit: false,
	license: { code: 'cc0', name: 'Creative Commons 0', url: 'https://creativecommons.org/publicdomain/zero/1.0/',
		requiresAttribution: false, commercialUseAllowed: true },
	durationSeconds: 12, originalFile: { format: 'wav', channels: 1, byteLength: 1_152_044,
		sampleRate: 48_000, md5: '0123456789abcdef0123456789abcdef' },
	statistics: { downloads: 42, averageRating: 4.75, ratingCount: 8 },
	preview: { available: true, format: 'ogg', quality: 'high', approximateBitrateKbps: 192 },
	waveform: { available: true, url: '/api/freesound/sounds/42/waveform?asset=789' },
};

for (const [initialGain, loadingGain] of [[0, 0], [1, 1], [1, .25], [1, 0]] as const) test(`Freesound listening gain starts at ${String(initialGain)}, loads at ${String(loadingGain)} and follows live and paused output changes`, async () => {
	const dom = installReactTestDom();
	const globals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = globals.IS_REACT_ACT_ENVIRONMENT;
	const priorAudio = globalThis.Audio, priorFetch = globalThis.fetch;
	globals.IS_REACT_ACT_ENVIRONMENT = true;
	const audios: PreviewAudio[] = [];
	globalThis.Audio = class extends PreviewAudio {
		constructor(source = '') { super(source); audios.push(this); }
	} as unknown as typeof Audio;
	globalThis.fetch = async () => Response.json({ data: { query: 'rain', page: 1, pageSize: 20,
		totalCount: 1, totalPages: 1, hasNextPage: false, hasPreviousPage: false, results: [SOUND] } });
	const controller = { actions: { project: { importFiles: async () => undefined } },
		getSnapshot: () => ({ productId: 'soundscaper', project: { id: 'project-a' } }),
		captureProjectGeneration: () => ({ projectId: 'project-a', generation: 1 }), assertProjectGeneration: () => undefined };
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	const render = async (gain: number) => { await act(async () => root.render(<FreesoundPanelContainer
		controller={controller} snapshot={{ locale: 'en', audioDevices: { playbackGain: gain }, project: { tracks: [] } }}
		copy={ENGLISH_COPY} freesoundTransport={{ request: async () => Response.json({ data: { connected: false } }),
			openAuthorization: () => undefined }} />)); };
	const clickPreview = async (label: string) => {
		const button = dom.container.querySelectorAll('button').find(node => node.getAttribute('aria-label') === `${label}: Rain.ogg`);
		assert.ok(button);
		await act(async () => reactProps(button).onClick());
	};
	let unmounted = false;
	try {
		await render(initialGain);
		await act(async () => reactProps(dom.one('input')).onChange({ currentTarget: { value: 'rain' } }));
		await act(async () => reactProps(dom.one('form')).onSubmit({ preventDefault() {} }));
		await clickPreview('Play preview');
		assert.equal(audios.length, 1);
		const audio = audios[0]!;
		assert.equal(audio.volume, initialGain, 'the actual new preview inherits the current listening output');
		assert.equal(audio.playCount, 1);
		await render(loadingGain);
		audio.volume = loadingGain === 0 ? 1 : 0;
		audio.dispatchEvent(new Event('loadedmetadata'));
		assert.equal(audio.volume, loadingGain, 'native initialization retains the latest requested gain, including mute');
		audio.volume = .4;
		audio.dispatchEvent(new Event('loadedmetadata'));
		assert.equal(audio.volume, .4, 'later native volume edits retain ownership');
		const liveGain = loadingGain === .25 ? .5 : .25;
		await render(liveGain);
		assert.equal(audio.volume, liveGain);
		audio.volume = 0;
		audio.dispatchEvent(new Event('loadeddata'));
		assert.equal(audio.volume, liveGain, 'data readiness also restores gain after a delayed native reset');
		audio.volume = .6;
		audio.dispatchEvent(new Event('loadeddata'));
		assert.equal(audio.volume, .6, 'later native data events retain volume ownership');
		assert.equal(audio.playCount, 1, 'changing listening gain retains the current preview transport');
		await clickPreview('Pause preview');
		await render(0);
		assert.equal(audio.volume, 0);
		await clickPreview('Play preview');
		assert.equal(audios.length, 1);
		assert.equal(audio.playCount, 2);
		assert.equal(audio.volume, 0, 'resume retains the listening gain applied while paused');
		await act(async () => reactProps(dom.one('form')).onSubmit({ preventDefault() {} }));
		await clickPreview('Play preview');
		assert.equal(audios.length, 2);
		audio.volume = 0.75;
		audio.dispatchEvent(new Event('loadeddata'));
		assert.equal(audio.volume, 0.75, 'replaced previews release gain readiness listeners');
		assert.equal(audios[1]?.volume, 0);
		const retiring = audios.at(-1)!;
		await act(async () => root.unmount()); unmounted = true;
		retiring.volume = .6;
		retiring.dispatchEvent(new Event('loadedmetadata'));
		assert.equal(retiring.volume, .6, 'retired media cannot apply a late readiness update');
		retiring.volume = .7;
		retiring.dispatchEvent(new Event('loadeddata'));
		assert.equal(retiring.volume, .7, 'retired media also releases its data readiness listener');
	} finally {
		if (!unmounted) await act(async () => root.unmount());
		globalThis.Audio = priorAudio; globalThis.fetch = priorFetch;
		globals.IS_REACT_ACT_ENVIRONMENT = priorAct; dom.restore();
	}
});

class PreviewAudio extends EventTarget {
	volume = 1;
	preload = '';
	playCount = 0;
	constructor(public src: string) { super(); }
	play(): Promise<void> { this.playCount += 1; return Promise.resolve(); }
	pause(): void {}
	load(): void {}
}
