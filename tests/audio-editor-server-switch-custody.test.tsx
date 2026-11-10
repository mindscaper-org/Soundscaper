/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act, useSyncExternalStore } from 'react';
import AdvancedPreferencesPage from '../src/common/editor/ui/dialogs/AdvancedPreferencesPage.tsx';
import AudiocomPanelContainer from '../src/common/editor/ui/workspace/AudiocomPanelContainer.tsx';
import { audiocomPanelSession } from '../src/common/editor/controller/import/audiocom-panel-session.ts';
import { loadAudioEditorPreferencesV1 } from '../src/common/editor/preferences.js';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import { controllerSession } from './helpers/soundscaper-controller-session.ts';
import { mountControllerDataDom, waitForControllerDataState } from './helpers/controller-data-dom.ts';
import { reactProps } from './helpers/react-test-dom.ts';

type Controller = Awaited<ReturnType<typeof controllerSession>>['controller'];
type Fixture = ReturnType<typeof mountControllerDataDom>;
const OFFICIAL = 'https://api.audio.com', CUSTOM = 'https://audiocity.example';

function Account({ controller, fixture }: Readonly<{ controller: Controller; fixture: Fixture }>) {
	const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
	const { preferences } = loadAudioEditorPreferencesV1(snapshot.preferences);
	return <><AdvancedPreferencesPage controller={controller} preferences={preferences} copy={ENGLISH_COPY} run={fixture.run} />
		<AudiocomPanelContainer controller={controller} snapshot={snapshot} copy={ENGLISH_COPY} locale="en" /></>;
}

test('real preference changes select the Request origin and retire previous account search/upload state', async context => {
	const requests: { readonly path: string; readonly origin: string | null; readonly method: string }[] = [];
	context.mock.method(globalThis, 'fetch', async (input: string | URL | Request, init?: RequestInit) => {
		const request = new Request(input, init), path = new URL(request.url).pathname;
		const origin = request.headers.get('x-audiocom-api-origin'); requests.push({ path, origin, method: request.method });
		const data = (value: unknown) => Response.json({ data: value });
		const provider = origin === CUSTOM
			? { kind: 'audiocity', apiOrigin: CUSTOM, webOrigin: CUSTOM, scope: 'public' }
			: { kind: 'audiocom', apiOrigin: OFFICIAL, webOrigin: 'https://audio.com', scope: 'all' };
		if (path === '/api/audiocom/usage') return data({ maximumUploadBytes: 100_000_000, projectStorageSupported: false, provider });
		if (path === '/api/audiocom/oauth/session') return data({ connected: origin !== CUSTOM && request.method !== 'DELETE' });
		if (path === '/api/audiocom/search') return data({ results: [{ id: '123', title: 'Previous server recording', authorName: 'Recorder',
			username: 'recorder', url: 'https://audio.com/recorder/audio/previous', description: '', license: 'cc-by', isDownloadable: false,
			durationSeconds: 2 }], page: 1, hasNext: false });
		return assert.fail(`Unexpected server-selection request: ${request.method} ${path}`);
	});
	const { controller, store } = await controllerSession(context, {
		engineFactory: () => { throw new Error('Server preferences must not render project audio.'); },
	});
	await controller.actions.project.flush();
	const project = structuredClone(controller.project), history = structuredClone(controller.getSnapshot().history);
	const fixture = mountControllerDataDom();
	const input = (type: string) => {
		const node = fixture.dom.container.querySelectorAll('input').find(node => node.type === type); assert.ok(node, `${type} input`); return node;
	};
	try {
		await fixture.render(<Account controller={controller} fixture={fixture} />);
		const previous = audiocomPanelSession(controller, { apiOrigin: OFFICIAL });
		await act(async () => { await waitForControllerDataState(previous, state => state.auth.status !== 'loading' && state.auth.status !== 'connecting', 'previous account initialization settles'); });
		assert.equal(previous.getSnapshot().auth.status, 'connected');
		const search = input('search');
		await act(async () => { reactProps(search).onChange({ currentTarget: { value: 'previous' } }); });
		await act(async () => {
			reactProps(fixture.dom.one('[role="search"]')).onSubmit({ preventDefault() {} });
			await waitForControllerDataState(previous, state => state.search.status === 'ready', 'actual search form publishes the result');
		});
		assert.ok(fixture.dom.container.querySelectorAll('a').some(node => node.textContent === 'Previous server recording'));
		const file = new File(['RIFF-draft'], 'previous-server.wav', { type: 'audio/wav' });
		const selected = { files: [file], value: file.name };
		await act(async () => { reactProps(input('file')).onChange({ currentTarget: selected }); });
		assert.equal(previous.getSnapshot().uploadQueue.items.length, 1);
		assert.equal(fixture.dom.one('[data-upload-status="draft"]').querySelector('strong')?.textContent, file.name);
		assert.equal(await file.text(), 'RIFF-draft');
		const priorRequestCount = requests.length;
		await act(async () => { reactProps(input('url')).onChange({ currentTarget: { value: CUSTOM } }); });
		const save = fixture.dom.container.querySelectorAll('button').find(node => node.textContent === 'Save server'); assert.ok(save);
		await act(async () => { reactProps(save).onClick(); await fixture.settle(); });
		assert.ok(requests.slice(priorRequestCount).some(request => request.path === '/api/audiocom/oauth/session' && request.origin === CUSTOM),
			'the mounted replacement session starts its request at the selected origin');
		const current = audiocomPanelSession(controller, { apiOrigin: CUSTOM });
		assert.notEqual(current, previous);
		await act(async () => { await waitForControllerDataState(current, state => state.auth.status !== 'loading' && state.auth.status !== 'connecting', 'new provider account initialization settles'); });
		assert.equal(current.getSnapshot().auth.status, 'disconnected');
		assert.deepEqual(current.getSnapshot().search, { query: '', page: 1, hasNext: false, status: 'idle', results: [] });
		assert.deepEqual(current.getSnapshot().uploadQueue, { active: false, items: [] });
		assert.ok(fixture.dom.container.querySelectorAll('button').some(node => node.textContent === 'Connect to Audiocity'));
		assert.equal(fixture.dom.container.querySelectorAll('a').filter(node => node.textContent === 'Previous server recording').length, 0);
		assert.equal(fixture.dom.container.querySelectorAll('[data-upload-status]').length, 0);
		assert.equal(input('search').value, '');
		const preferences = loadAudioEditorPreferencesV1(controller.getSnapshot().preferences).preferences;
		assert.equal(preferences.advanced.audioComServerUrl, CUSTOM);
		const stored: unknown = await store.loadSetting('soundscaper:audio-editor-preferences-v1');
		assert.ok(stored !== null && typeof stored === 'object', 'selected server preferences reach the actual product setting');
		assert.equal(loadAudioEditorPreferencesV1(stored).preferences.advanced.audioComServerUrl, CUSTOM);
		assert.ok(requests.slice(0, priorRequestCount).every(request => request.origin === OFFICIAL));
		assert.ok(requests.every(request => request.origin === CUSTOM || request.origin === OFFICIAL));
		assert.deepEqual(controller.project, project); assert.deepEqual(controller.getSnapshot().history, history);
	} finally { await fixture.dispose(); }
});
