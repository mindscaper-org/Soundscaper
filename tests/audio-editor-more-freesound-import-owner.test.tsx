/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import React, { act } from 'react';

import { FreesoundPanelContainer } from '../src/common/editor/ui/workspace/FreesoundPanelContainer.tsx';
import { EditorProjectGeneration } from '../src/common/editor/controller/shared/lifecycle.ts';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import { ordinaryOggOpusFixture } from './helpers/ordinary-ogg-opus-fixture.ts';
import { createFixture, deferred } from './audio-editor-project-import-service-fixture.ts';
import { createProjectImportService } from './helpers/project-import-runtime-fixture.ts';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

for (const pendingOriginal of [false, true]) {
	test(`Freesound preview fallback stays with its original project when original response pending=${String(pendingOriginal)}`, async () => {
		const fixture = createFixture();
		const service = createProjectImportService(fixture.runtime);
		const generation = new EditorProjectGeneration(); generation.activate('project-a');
		let projectId = 'project-a';
		const imports: string[] = [];
		const importWork: Promise<unknown>[] = [];
		const controller = {
			actions: { project: { importFiles: async (files: File[], options: Readonly<Record<string, unknown>> = {}) => {
				imports.push(projectId); const work = service.importFiles(files, options); importWork.push(work); return work;
			} } },
			getSnapshot: () => ({ productId: 'soundscaper', project: { id: projectId }, importing: false, readOnly: false }),
			captureProjectGeneration: () => generation.capture(projectId),
			assertProjectGeneration: (token: Parameters<typeof generation.assertCurrent>[0]) => { generation.assertCurrent(token); },
		};
		const original = deferred<void>();
		const requested = deferred<void>();
		const preview = await ordinaryOggOpusFixture();
		const priorFetch = globalThis.fetch;
		globalThis.fetch = async input => {
			const url = new URL(String(input), 'https://soundscaper.org');
			if (url.protocol === 'file:') return new Response(Uint8Array.from(await readFile(url)));
			const path = url.pathname;
			if (path.endsWith('/preview')) return new Response(await preview.arrayBuffer(), { headers: { 'Content-Type': 'audio/ogg' } });
			if (path.endsWith('/search')) return Response.json({ data: { query: 'rain', page: 1, pageSize: 20,
				totalCount: 1, totalPages: 1, hasNextPage: false, hasPreviousPage: false, results: [SOUND] } });
			return Response.json({ data: SOUND });
		};
		const transport = { request: async (path: string) => {
			if (path.includes('/original')) { requested.resolve(); if (pendingOriginal) await original.promise; return new Response(null, { status: 413 }); }
			if (path.endsWith('/oauth/session')) return Response.json({ data: { connected: true, user: { id: 5, username: 'recorder' } } });
			if (path.endsWith('/uploads/pending')) return Response.json({ data: { pendingDescription: [], pendingProcessing: [], pendingModeration: [] } });
			throw new Error(`Unexpected local fixture path ${path}`);
		}, openAuthorization() {} };
		const dom = installReactTestDom();
		const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
		const priorAct = actGlobal.IS_REACT_ACT_ENVIRONMENT; actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
		const { createRoot } = await import('react-dom/client');
		const root = createRoot(dom.container as unknown as Element);
		const render = () => <FreesoundPanelContainer controller={controller} copy={ENGLISH_COPY}
			snapshot={{ locale: 'en', project: { id: projectId } }} freesoundTransport={transport}
			confirmFileSizeWarning={async () => true} />;
		const flush = async () => act(async () => { await new Promise<void>(resolve => setTimeout(resolve, 0)); });
		const button = (prefix: string) => dom.container.querySelectorAll('button')
			.find(candidate => candidate.querySelector('.button__text')?.textContent.startsWith(prefix));
		try {
			await act(async () => root.render(render())); await flush();
			const search = dom.container.querySelectorAll('input').find(input => input.type === 'search'); assert.ok(search);
			await act(async () => reactProps(search).onChange({ currentTarget: { value: 'rain' } }));
			await act(async () => reactProps(dom.one('form')).onSubmit({ preventDefault() {} })); await flush();
			const add = button('Add to Project Bin'); assert.ok(add);
			await act(async () => { reactProps(add).onClick(); await requested.promise; }); await flush();
			if (!pendingOriginal) assert.ok(dom.find('[data-freesound-original-fallback-dialog="true"]'));
			projectId = 'project-b'; generation.activate(projectId);
			fixture.setProject({ id: projectId, metadata: {}, tracks: [], sources: [] });
			await act(async () => root.render(render()));
			original.resolve(); await flush();
			const confirm = button('Import HQ preview');
			if (confirm) { await act(async () => reactProps(confirm).onClick()); await flush(); await flush(); }
			await act(async () => { await Promise.allSettled(importWork); });
			assert.deepEqual(imports, [], 'an abandoned choice must not import into the replacement project');
			assert.equal(dom.find('[data-freesound-original-fallback-dialog="true"]'), null);
		} finally {
			original.resolve(); await flush();
			await act(async () => { await Promise.allSettled(importWork); });
			await act(async () => root.unmount());
			globalThis.fetch = priorFetch; actGlobal.IS_REACT_ACT_ENVIRONMENT = priorAct; dom.restore();
		}
	});
}

const SOUND = {
	id: 42, name: 'Rain.ogg', pageUrl: 'https://freesound.org/s/42/',
	creator: { username: 'recorder', pageUrl: 'https://freesound.org/people/recorder/' }, description: 'Steady rain.', tags: ['rain'],
	category: 'Sound effects', subcategory: 'Weather', createdAt: '2026-04-16T20:07:11.145',
	license: { code: 'cc-by', name: 'Attribution 4.0', url: 'https://creativecommons.org/licenses/by/4.0/', requiresAttribution: true, commercialUseAllowed: true },
	generativeAiPreference: null, explicit: false, durationSeconds: 1,
	originalFile: { format: 'ogg', channels: 1, byteLength: 128 * 1024 * 1024 + 1, sampleRate: 48_000, md5: '0123456789abcdef0123456789abcdef' },
	statistics: { downloads: 42, averageRating: 4.75, ratingCount: 8 },
	preview: { available: true, format: 'ogg', quality: 'high', approximateBitrateKbps: 192 },
	waveform: { available: false, url: null },
};
