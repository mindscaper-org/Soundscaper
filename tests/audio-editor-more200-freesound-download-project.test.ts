/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createFreesoundWorkspaceActions } from '../src/common/editor/ui/workspace/freesound-workspace-service.ts';
import { createSoundscaperProjectRuntimeSelection } from '../src/soundscaper/editor-project-runtime-selection.ts';
import { COPY, createAudioEditorController, createMemoryEngine, createProjectStore } from './helpers/audio-editor-controller-harness.js';
import { createMemoryFfmpeg } from './helpers/audio-editor-controller-fixtures.js';

for (const retirement of ['new project', 'reopened generation', 'cancelled request']) test(`an outgoing Freesound download cannot hold ${retirement} admission`, async context => {
	type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;
	const runtime = createSoundscaperProjectRuntimeSelection();
	const controller = createAudioEditorController(null, { headless: true, locale: 'en', copy: COPY,
		projectRuntime: runtime, sessionController: runtime.createSessionController(),
		engine: createMemoryEngine() as unknown as Options['engine'], ffmpeg: createMemoryFfmpeg() as unknown as Options['ffmpeg'],
		store: createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: context.name }) });
	context.after(async () => { await controller.dispose(); });
	await controller.ready;
	const details = [deferred<Response>(), deferred<Response>()];
	let requests = 0;
	const actions = createFreesoundWorkspaceActions(controller, { fetch: () => {
		const response = details[requests++]; assert.ok(response); return response.promise;
	} });
	const cancellation = new AbortController();
	const outgoing = actions.importSound({ soundId: 42, destination: 'project-bin', signal: cancellation.signal });
	const outgoingRefusal = assert.rejects(outgoing, /project changed|no longer current|abort/iu);
	let incomingOutcome: Promise<unknown> | undefined;
	try {
		const original = controller.project;
		if (retirement === 'cancelled request') cancellation.abort();
		else {
			await controller.actions.project.create({ title: 'Fresh project' });
			if (retirement === 'reopened generation') await controller.actions.project.open(original);
		}
		const incoming = actions.importSound({ soundId: 43, destination: 'project-bin' });
		incomingOutcome = incoming.then(() => null, (error: unknown) => error);
		assert.equal(requests, 2, 'the fresh project must reach its own file download');
		details[0]!.resolve(Response.json({ data: soundWithoutPreview(42) }));
		await outgoingRefusal;
		await assert.rejects(actions.importSound({ soundId: 44, destination: 'project-bin' }), /already in progress/iu,
			'the old completion must not release a newer admission');
		details[1]!.resolve(Response.json({ data: soundWithoutPreview(43) }));
		assert.match(String(await incomingOutcome), /no HQ OGG preview/iu);
		assert.equal(controller.project?.sources.length, 0);
	} finally {
		for (const detail of details) detail.resolve(Response.json({ data: soundWithoutPreview(42) }));
		await outgoingRefusal;
		await incomingOutcome;
	}
});

function deferred<Value>() {
	let resolve!: (value: Value) => void;
	const promise = new Promise<Value>(complete => { resolve = complete; });
	return { promise, resolve };
}

function soundWithoutPreview(id: number) {
	return { id, name: 'Rain close.ogg', pageUrl: `https://freesound.org/s/${id}/`,
		creator: { username: 'recorder', pageUrl: 'https://freesound.org/people/recorder/' },
		description: 'A field recording.', tags: ['rain'], category: null, subcategory: null,
		createdAt: '2026-04-16T20:07:11.145', generativeAiPreference: null, explicit: false, durationSeconds: 1,
		license: { code: 'cc-by', name: 'Attribution 4.0', url: 'https://creativecommons.org/licenses/by/4.0/', requiresAttribution: true, commercialUseAllowed: true },
		originalFile: { format: 'ogg', channels: 1, byteLength: 4096, sampleRate: 48_000, md5: '0123456789abcdef0123456789abcdef' },
		statistics: { downloads: 42, averageRating: 4.75, ratingCount: 8 },
		preview: { available: false, format: 'ogg', quality: 'high', approximateBitrateKbps: 192 } };
}
