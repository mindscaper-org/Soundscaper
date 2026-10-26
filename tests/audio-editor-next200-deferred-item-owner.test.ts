/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createAudacityDeferredProjectActions } from '../src/common/editor/audacity-action-runtime-helpers.ts';
import { createAudacityActionRuntime } from '../src/common/editor/audacity-action-runtime.js';

function project(id: string) {
	return { id, sampleRate: 48_000, revision: 0, master: { channelCount: 2 },
		selection: { startFrame: 0, endFrame: 0, trackIds: ['track'], clipIds: ['first'] },
		tracks: [{ id: 'track', type: 'audio', clipIds: ['first', 'second'], gain: 1 }],
		clips: ['first', 'second'].map((id, index) => ({ id, sourceId: 'source',
			timelineStartFrame: index * 48_000, sourceStartFrame: 0, sourceDurationFrames: 48_000, durationFrames: 48_000 })),
		sources: [{ id: 'source', sampleRate: 48_000, frameCount: 48_000, channelCount: 2 }],
	};
}
function fixture() {
	let current = project('outgoing');
	let generation = 1;
	const calls: unknown[] = [];
	const record = (...args: unknown[]) => { calls.push(args); return 'applied'; };
	const controller = {
		getSnapshot: () => ({ project: current, selectedClipId: 'first', selectedTrackId: 'track', timeline: { pixelsPerSecond: 120 } }),
		captureProjectGeneration: () => ({ projectId: current.id, generation }),
		actions: { sampleEdit: { setMode: record }, clip: { setTimePitch: record, move: record },
			labels: { add: record, update: record }, effects: {}, spectral: {}, project: {}, export: {},
			edit: { commit: record }, timeline: { selectClip: record }, recording: {}, transport: {},
			audioDevices: {}, track: {}, preferences: {}, macros: {}, generators: {} },
	};
	const runtime = createAudacityActionRuntime(controller);
	return { calls, runtime,
		activate(id: string) { current = project(id); generation++; },
		edit() { current = { ...current, revision: current.revision + 1 }; },
	};
}

for (const action of ['move', 'relative', 'mixer'] as const) {
	for (const transition of ['switch', 'aba', 'edit', 'same', 'dispose'] as const) {
		test(`deferred ${action} action keeps its activation through ${transition}`, async () => {
			const f = fixture();
			try {
				const pending = action === 'move' ? f.runtime.actions.navigation.moveItemRight()
					: action === 'relative' ? f.runtime.actions.navigation.nextItem()
						: f.runtime.actions.track.audacityMixer('track-gain-inc');
				if (transition === 'switch' || transition === 'aba') f.activate('incoming');
				if (transition === 'aba') f.activate('outgoing');
				if (transition === 'edit') f.edit();
				if (transition === 'dispose') f.runtime.dispose();
				await pending;
				const remains = transition === 'edit' || transition === 'same';
				assert.equal(f.calls.length, remains ? 1 : 0);
				if (transition === 'switch' || transition === 'aba') {
					await (action === 'move' ? f.runtime.actions.navigation.moveItemRight()
						: action === 'relative' ? f.runtime.actions.navigation.nextItem()
							: f.runtime.actions.track.audacityMixer('track-gain-inc'));
					assert.equal(f.calls.length, 1, 'a fresh action on the incoming activation works');
				}
			} finally { f.runtime.dispose(); }
		});
	}
}

for (const retirement of ['none', 'switch', 'dispose'] as const) {
	for (const fails of [false, true]) {
		test(`deferred load ${fails ? 'failure' : 'success'} honors ${retirement} ownership`, async () => {
			let generation = 1;
			const actions = createAudacityDeferredProjectActions({
				getSnapshot: () => ({ project: { id: 'project' } }),
				captureProjectGeneration: () => ({ projectId: 'project', generation }),
			});
			let resolve: (value: string) => void = () => undefined;
			let reject: (reason: unknown) => void = () => undefined;
			const loading = new Promise<string>((fulfill, fail) => { resolve = fulfill; reject = fail; });
			let applied = 0;
			const pending = actions.run(() => loading, value => { applied++; return value; });
			if (retirement === 'switch') generation++;
			if (retirement === 'dispose') actions.dispose();
			const reason = new Error('Loading failed');
			if (fails) reject(reason); else resolve('loaded');
			if (fails && retirement === 'none') await assert.rejects(pending, error => error === reason);
			else assert.equal(await pending, retirement === 'none' ? 'loaded' : null);
			assert.equal(applied, !fails && retirement === 'none' ? 1 : 0);
		});
	}
}

test('a retired controller or invalid epoch never starts lazy work', async () => {
	for (const invalid of [null, { projectId: 'other', generation: 1 }, { projectId: 'project', generation: NaN }]) {
		const actions = createAudacityDeferredProjectActions({ getSnapshot: () => ({ project: { id: 'project' } }),
			captureProjectGeneration: () => invalid });
		assert.equal(await actions.run(() => { throw new Error('Must not load'); }, () => 1), null);
	}
	const disposed = createAudacityDeferredProjectActions({ getSnapshot: () => { throw new Error('Disposed'); } });
	assert.equal(await disposed.run(() => { throw new Error('Must not load'); }, () => 1), null);
});

test('legacy narrow ports without generation retain ordinary navigation', async () => {
	const actions = createAudacityDeferredProjectActions({ getSnapshot: () => ({ project: { id: 'legacy' } }) });
	assert.equal(await actions.run(() => Promise.resolve('loaded'), value => value), 'loaded');
});
