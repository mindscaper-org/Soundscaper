/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createAudioAnalysisService, type AnalysisDependencies } from '../src/common/editor/controller/analysis/analysis-service.ts';
import { EditorControllerLifetime, EditorProjectGeneration } from '../src/common/editor/controller/shared/lifecycle.ts';
import { calculateAudioAnalysisReport } from '../src/common/editor/audio-analysis-report-worker-runtime.ts';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';

function fixture() {
	const lifetime = new EditorControllerLifetime(); lifetime.markReady();
	const generation = new EditorProjectGeneration(); generation.activate('spectrum');
	let tracks = [{ id: 'low', name: 'Bass', color: 'blue' }, { id: 'high', name: 'Lead', color: 'orange' }];
	let revision = 1;
	const range = { startFrame: 48_000, endFrame: 50_048 };
	const rendered: Array<{ scope: string; trackId?: string | null }> = [];
	const shown: unknown[] = [];
	const errors: unknown[] = [];
	let afterRender = () => {};
	const dependencies: AnalysisDependencies = {
		lifetime, state: { lastAnalysisRequest: null }, copy: ENGLISH_COPY,
		captureProject: () => generation.capture('spectrum'), assertProject: token => generation.assertCurrent(token),
		getProject: () => ({ id: 'spectrum', revision, clips: [{}] }), getSelectedTrackId: () => 'unselected',
		getSpectrumTracks: () => tracks, getRange: () => range, getActiveSelection: () => range,
		getSpectrumWindowSize: () => 2048,
		getContrastSelections: () => ({ foreground: null, background: null }), setContrastSelections() {},
		loadAnalysis: async () => null, saveAnalysis: async () => undefined,
		renderAudio: async (scope, requested, _signal, trackId) => {
			assert.deepEqual(requested, range);
			rendered.push({ scope, trackId });
			const tone = (frequency: number, frame: number) => 0.25 * Math.sin(2 * Math.PI * frequency * frame / 48_000);
			const samples = Float32Array.from({ length: 2048 }, (_, frame) => scope === 'master'
				? tone(750, frame) + tone(6000, frame) : tone(trackId === 'low' ? 750 : 6000, frame));
			afterRender();
			return { sampleRate: 48_000, numberOfChannels: 1, length: samples.length, getChannelData: () => samples };
		},
		analyzeChannels: () => assert.fail('Spectrum must not compute unrelated meters'), createVisuals: () => null,
		createSpecializedReport: async (kind, scope, requested, channels, sampleRate, options) =>
			calculateAudioAnalysisReport({ kind, scope, range: requested, channels, sampleRate, options }),
		showAnalysis: (_result, _visuals, report) => { shown.push(report); },
		setProcessing() {}, setStatus() {}, publish() {}, handleError: error => { errors.push(error); },
	};
	return { service: createAudioAnalysisService(dependencies), lifetime, rendered, shown, errors,
		select: (ids: string[]) => { tracks = ids.map(id => tracks.find(track => track.id === id)!); },
		afterRender: (callback: () => void) => { afterRender = callback; }, edit: () => { revision++; } };
}

function spectrum(value: unknown) {
	assert.ok(value && typeof value === 'object' && 'tracks' in value);
	return value as { bins: unknown[]; tracks: Array<{ trackId: string; name: string; color: string;
		peak: { frequency: number; db: number }; bins: Array<{ db: number }> }> };
}

test('multi-track spectrum retains isolated peaks, track colors and cached repeat', async () => {
	const f = fixture();
	const report = spectrum(await f.service.plotSpectrum());
	assert.deepEqual(report.tracks.map(track => [track.trackId, track.name, track.color, track.peak.frequency]),
		[['low', 'Bass', 'blue', 750], ['high', 'Lead', 'orange', 6000]]);
	for (const track of report.tracks) assert.ok(Math.abs(track.peak.db - 20 * Math.log10(0.25)) < 0.01);
	assert.ok(report.tracks[0]!.bins[256]!.db < -90, 'the bass curve must not contain the lead tone');
	assert.ok(report.tracks[1]!.bins[32]!.db < -90, 'the lead curve must not contain the bass tone');
	assert.deepEqual(f.rendered, [{ scope: 'master', trackId: null }, { scope: 'track', trackId: 'low' }, { scope: 'track', trackId: 'high' }]);
	assert.equal(await f.service.repeatLast(), report);
	assert.equal(f.rendered.length, 3);
	assert.deepEqual(f.errors, []);
});

test('changing selected tracks invalidates the overlay cache without a document edit', async () => {
	const f = fixture();
	await f.service.plotSpectrum();
	f.select(['high']);
	const report = await f.service.repeatLast();
	assert.ok(report && typeof report === 'object');
	assert.equal('tracks' in report, false, 'single-track selections keep the ordinary spectrum');
	assert.equal(f.rendered.length, 4);
});

test('explicit track scope keeps its single isolated spectrum', async () => {
	const f = fixture();
	const report = await f.service.plotSpectrum('track');
	assert.ok(report && typeof report === 'object');
	assert.equal('tracks' in report, false);
	assert.deepEqual(f.rendered, [{ scope: 'track', trackId: 'unselected' }]);
});

test('an in-flight spectrum retains the tracks selected when the request started', async () => {
	const f = fixture();
	f.afterRender(() => { f.select(['high']); });
	const report = spectrum(await f.service.plotSpectrum());
	assert.deepEqual(report.tracks.map(track => track.trackId), ['low', 'high']);
	assert.deepEqual(f.errors, []);
});

for (const change of ['cancel', 'edit'] as const) {
	test(`multi-track spectrum does not publish partial curves after ${change}`, async () => {
		const f = fixture();
		f.afterRender(() => { if (f.rendered.length === 2) { if (change === 'cancel') f.lifetime.cancelTask('analysis'); else f.edit(); } });
		assert.equal(await f.service.plotSpectrum(), null);
		assert.equal(f.rendered.length, 2);
		assert.deepEqual(f.shown, []);
	});
}
