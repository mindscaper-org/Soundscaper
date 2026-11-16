/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { observeLivePlaybackSpectrum, observeSelectedSpectrum, type LivePlaybackSpectrumReport } from '../src/common/editor/controller/analysis/live-spectrum-session.ts';
import { deferred } from './helpers/async-test-control.ts';

test('live spectrum publishes independent track peaks, updates playback and releases its timer', () => {
	let tick = () => {};
	let stopped = false;
	let released = 0;
	let canceled = 0;
	let bassBin = 64;
	const reports: Array<LivePlaybackSpectrumReport | null> = [];
	const dispose = observeLivePlaybackSpectrum({
		acquire: () => ({ fftSize: 4096, release: () => { released++; }, read: (id, target) => {
			target.fill(-Infinity);
			if (stopped) return null;
			target[id === 'bass' ? bassBin : 512] = id === 'bass' ? -6 : -18;
			return { fftSize: 4096, frequencyBinCount: 2048, sampleRate: 48_000, minDecibels: -120, maxDecibels: 0 };
		} }),
		tracks: [{ id: 'bass', name: 'Bass', color: 'blue' }, { id: 'lead', name: 'Lead', color: 'orange' }],
		position: () => 96_000,
		publish: report => reports.push(report),
		schedule: callback => { tick = callback; return () => { canceled++; }; },
		onError: error => assert.fail(String(error)),
	});
	const first = reports[0]!;
	assert.deepEqual(first.tracks.map(track => [track.name, track.color, track.peak?.frequency, track.peak?.db]),
		[['Bass', 'blue', 750, -6], ['Lead', 'orange', 6000, -18]]);
	assert.equal(first.positionFrame, 96_000);
	bassBin = 128;
	tick();
	assert.equal(reports[1]!.tracks[0]!.peak?.frequency, 1500);
	assert.equal(first.tracks[0]!.peak?.frequency, 750, 'published reports must remain immutable snapshots');
	stopped = true; tick();
	assert.equal(reports[2], null, 'stopped playback must not leave a stale live reading');
	dispose(); dispose(); tick();
	assert.equal(released, 1);
	assert.equal(canceled, 1);
	assert.equal(reports.length, 3);
});

test('live spectrum sampling failure releases its resources and reports the error once', () => {
	let released = 0;
	let canceled = 0;
	const failure = new Error('graph changed');
	const errors: unknown[] = [];
	const dispose = observeLivePlaybackSpectrum({
		acquire: () => ({ fftSize: 4096, release: () => { released++; }, read: () => { throw failure; } }),
		tracks: [], position: () => 0, publish: () => assert.fail('no partial report'),
		schedule: () => () => { canceled++; }, onError: error => errors.push(error),
	});
	dispose();
	assert.deepEqual(errors, [failure]);
	assert.equal(released, 1);
	assert.equal(canceled, 1);
});

test('selection spectrum ignores a pending reply after the panel range changes', async () => {
	const pending = deferred<unknown>();
	let analyze = () => {};
	let canceled = 0;
	const dispose = observeSelectedSpectrum({
		analyze: () => pending.promise, publish: () => assert.fail('stale range report'),
		schedule: callback => { analyze = callback; return () => { canceled++; }; },
		onError: () => assert.fail('stale range error'),
	});
	analyze(); await Promise.resolve();
	dispose(); dispose();
	pending.resolve({ bins: [], size: 2048, sampleRate: 48_000 });
	await pending.promise; await Promise.resolve();
	assert.equal(canceled, 1);
});
