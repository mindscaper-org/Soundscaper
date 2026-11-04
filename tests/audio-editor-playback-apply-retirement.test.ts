/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { EditorControllerLifetime } from '../src/common/editor/controller/shared/lifecycle.ts';
import { createPlaybackProjectApplyService } from '../src/common/editor/controller/source/playback-project-service.ts';
import { createPreparedProjectSources } from '../src/common/editor/controller/source/internal/prepared-project-sources.ts';
import { createAudioEditorEngine } from '../src/common/editor/engine/runtime-class.ts';
import type { EngineAudioContext } from '../src/common/editor/engine/public-api.ts';
import type { EngineProject } from '../src/common/editor/engine/types.ts';
import type { EngineRuntimeHost } from '../src/common/editor/engine/runtime-types.ts';
import { deferred } from './helpers/async-test-control.ts';
import { MockAudioBuffer, MockAudioContext } from './helpers/mock-audio-context.js';

for (const newerPrepared of [false, true]) {
	for (const rejectOlder of [false, true]) {
		test(`a late ${rejectOlder ? 'rejected' : 'resolved'} apply cannot retire newer ${newerPrepared ? 'prepared' : 'ordinary'} playback`, async () => {
			const fixture = applyFixture({ newerPrepared });
			const older = fixture.apply.apply(fixture.first);
			const olderSettled = older.then(() => null, (error: unknown) => error);
			await fixture.entered.promise;
			fixture.selectSecond();
			assert.equal(await fixture.apply.apply(fixture.second), true);
			const failure = new Error('older apply failed after newer playback began');
			if (rejectOlder) fixture.release.reject(failure);
			else fixture.release.resolve();
			const result = await olderSettled;
			assert.equal(rejectOlder ? result === failure : result instanceof DOMException, true);
			assert.equal(fixture.engineState(), 'playing', 'old retirement must not stop the current graph');
			assert.equal(fixture.stops(), 0);
			assert.equal(fixture.firstDisposals(), 1, 'unpublished old providers are still released');
			assert.equal(fixture.secondDisposals(), 0);
			assert.equal(fixture.appliedSignals.every(signal => signal instanceof AbortSignal), true);
		});
	}
}

test('stale source cleanup preserves a provider transferred to newer playback', async () => {
	const fixture = applyFixture({ newerPrepared: true, sharedProvider: true });
	const older = fixture.apply.apply(fixture.first).catch((error: unknown) => error);
	await fixture.entered.promise;
	fixture.selectSecond();
	assert.equal(await fixture.apply.apply(fixture.second), true);
	fixture.release.resolve();
	assert.ok((await older) instanceof DOMException);
	assert.equal(fixture.firstDisposals(), 0, 'the live registry now owns the shared provider');
	assert.equal(fixture.providers.get('required'), fixture.firstProvider);
});

test('failed candidate preparation preserves the old playing graph before releasing its private provider', async () => {
	const fixture = applyFixture({ newerPrepared: false });
	const applying = fixture.apply.apply(fixture.first);
	const result = applying.catch((error: unknown) => error);
	await fixture.entered.promise;
	const failure = new Error('candidate preparation failed before handoff');
	fixture.release.reject(failure);
	assert.equal(await result, failure);
	assert.equal(fixture.engineState(), 'playing');
	assert.equal(fixture.stops(), 0, 'a rejected atomic apply leaves the prior graph current');
	assert.equal(fixture.firstDisposals(), 1);
});

for (const fallback of [false, true]) test(`a canonical edit still preparing prevents an older ${fallback ? 'fallback' : 'ordinary'} candidate from replacing old playback`, async () => {
	const context = new MockAudioContext();
	const original: EngineProject = {
		id: 'canonical-fence', title: 'Original', sampleRate: 48_000,
		clips: [{ id: 'clip', sourceId: 'source', timelineStartFrame: 0, sourceStartFrame: 0, durationFrames: 480_000 }],
		tracks: [{ id: 'track', clipIds: ['clip'], gain: 1, pan: 0, mute: false, solo: false, effects: [] }],
		master: { gain: 1, effects: [] },
	};
	const sources = new Map([['source', new MockAudioBuffer(1, 480_000, 48_000) as unknown as AudioBuffer]]);
	const engine = createAudioEditorEngine({ audioContextFactory: () => context as unknown as EngineAudioContext });
	const host = engine as unknown as EngineRuntimeHost;
	engine.loadProject(original, sources);
	await engine.play();
	const oldGraph = host.graph;
	const next = { ...original, title: 'First edit' };
	let current: EngineProject = next;
	const entered = deferred<void>();
	const resume = deferred<void>();
	const providers = new Map();
	context.resume = () => { entered.resolve(); return resume.promise; };
	const apply = createPlaybackProjectApplyService<EngineProject, AudioBuffer>({
		lifetime: new EditorControllerLifetime(),
		projectForPlayback: project => ({ project, featureRequirementsReport: null,
			audioEffectPlaybackBypass: null, audioRenderedFallback: null,
			videoEffectPlaybackBypass: null, videoRenderedFallback: null,
			requiredAudioSourceIds: fallback ? ['source'] : [], requiredVideoSourceIds: [] }),
		getCurrentProject: () => current,
		ensureProjectSourcesAvailable: () => new Map(),
		prepareRequiredProjectSources: (_project, options) => createPreparedProjectSources({
			prepared: new Map([['source', { kind: 'buffer' as const, value: sources.get('source')! }]]),
			signal: options.signal, sourceBuffers: sources, sourceChunkProviders: providers,
			cacheSourceBuffer: (id, buffer) => sources.set(id, buffer),
			throwIfAborted(signal) { signal?.throwIfAborted(); },
		}),
		sourceBuffers: sources, sourceChunkProviders: providers,
		engine, setReadyStatus() {},
	});
	try {
		const applying = apply.apply(next);
		const result = applying.catch((error: unknown) => error);
		await entered.promise;
		current = { ...original, title: 'Newer edit still preparing' };
		resume.resolve();
		assert.ok((await result) instanceof DOMException);
		assert.equal(host.project?.title, 'Original');
		assert.equal(host.graph, oldGraph);
		assert.equal(engine.getState().state, 'playing');
	} finally { resume.resolve(); await engine.dispose(); }
});

function applyFixture(options: Readonly<{ newerPrepared: boolean; sharedProvider?: boolean }>) {
	const first = { id: 'first' };
	const second = { id: 'second' };
	let current = first;
	let state = 'playing';
	let stopped = 0;
	let disposedFirst = 0;
	let disposedSecond = 0;
	const firstProvider = { dispose() { disposedFirst += 1; } };
	const secondProvider = options.sharedProvider ? firstProvider : { dispose() { disposedSecond += 1; } };
	const providers = new Map<string, typeof firstProvider>();
	const entered = deferred<void>();
	const release = deferred<void>();
	const appliedSignals: Array<AbortSignal | undefined> = [];
	const apply = createPlaybackProjectApplyService({
		lifetime: new EditorControllerLifetime(),
		projectForPlayback: (project: typeof first) => ({
			project, featureRequirementsReport: null, audioEffectPlaybackBypass: null,
			audioRenderedFallback: null, videoEffectPlaybackBypass: null, videoRenderedFallback: null,
			requiredAudioSourceIds: project === first || options.newerPrepared ? ['required'] : [],
			requiredVideoSourceIds: [],
		}),
		getCurrentProject: () => current,
		ensureProjectSourcesAvailable: () => new Map(),
		prepareRequiredProjectSources: (project, request) => createPreparedProjectSources({
			prepared: new Map([['required', { kind: 'provider' as const,
				value: project === first ? firstProvider : secondProvider }]]),
			signal: request.signal, sourceBuffers: new Map(), sourceChunkProviders: providers,
			cacheSourceBuffer() {}, throwIfAborted(signal) { signal?.throwIfAborted(); },
		}),
		sourceBuffers: new Map(), sourceChunkProviders: providers,
		engine: {
			getState: () => ({ state, playbackMode: 'normal' }),
			stop() { stopped += 1; state = 'stopped'; },
			async applyProject(project, _buffers, request) {
				appliedSignals.push(request.signal);
				state = 'playing';
				if (project === first) { entered.resolve(); await release.promise; }
			},
		},
		setReadyStatus() {},
	});
	return { first, second, apply, entered, release, providers, firstProvider, appliedSignals,
		selectSecond() { current = second; }, engineState: () => state, stops: () => stopped,
		firstDisposals: () => disposedFirst, secondDisposals: () => disposedSecond };
}
