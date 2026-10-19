/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import {
	audacityAutoDuckEnvelope,
	prepareAudacityClassicFilterResponse,
	projectAudacityClassicFilterResponse,
	audacityLegacyCompressorResponse,
} from '../src/common/editor/ui/audacity-legacy-effect-graphs.ts';

function classicFilterPlot(parameters: Readonly<Record<string, unknown>>, sampleRate: number) {
	return projectAudacityClassicFilterResponse(prepareAudacityClassicFilterResponse(parameters, sampleRate));
}

function gainAt(response: ReturnType<typeof prepareAudacityClassicFilterResponse>, frequency: number): number {
	const x = Math.log(frequency / response.minimumFrequency)
		/ Math.log(response.maximumFrequency / response.minimumFrequency) * 100;
	const upper = response.points.findIndex(point => point.x >= x);
	assert.ok(upper >= 0, 'the prepared graph spans the requested frequency');
	const right = response.points[upper]!;
	if (upper === 0) return right.gainDb;
	const left = response.points[upper - 1]!;
	return left.gainDb + (right.gainDb - left.gainDb) * (x - left.x) / (right.x - left.x);
}

test('legacy compressor graph preserves Audacity wx normalized threshold and ratio geometry', () => {
	const response = audacityLegacyCompressorResponse({ thresholdDb: -12, ratio: 2 });
	assert.deepEqual(response.points, [{ x: 0, y: 90 }, { x: 80, y: 10 }, { x: 100, y: 0 }]);
	assert.deepEqual(audacityLegacyCompressorResponse({ thresholdDb: -12, ratio: 2, normalize: false, usePeak: true }), response);
	assert.notEqual(audacityLegacyCompressorResponse({ thresholdDb: -24, ratio: 4 }).line, response.line);
});

test('Auto Duck envelope matches its original pixel-per-second and pixel-per-dB scales', () => {
	const envelope = audacityAutoDuckEnvelope({});
	assert.deepEqual(envelope.points, [
		{ x: 10, y: 50 }, { x: 130, y: 50 }, { x: 150, y: 146 },
		{ x: 450, y: 146 }, { x: 470, y: 50 }, { x: 590, y: 50 },
	]);
	const edited = audacityAutoDuckEnvelope({ duckAmountDb: -6, innerFadeDown: 0.25, innerFadeUp: 0.75, outerFadeDown: 1, outerFadeUp: 1.5 });
	assert.deepEqual(edited.points, [
		{ x: 10, y: 50 }, { x: 110, y: 50 }, { x: 160, y: 98 },
		{ x: 420, y: 98 }, { x: 510, y: 50 }, { x: 590, y: 50 },
	]);
	assert.deepEqual(edited.controls.find(control => control.id === 'duckAmountDb'), { id: 'duckAmountDb', x: 290, y: 98, value: -6, unit: 'dB', above: true });
});

test('Auto Duck follows wx integer truncation and ignores pause/threshold settings in its fade diagram', () => {
	const settings = { innerFadeDown: 0.01, duckAmountDb: -12.1 };
	assert.equal(audacityAutoDuckEnvelope(settings).points[2]?.x, 150);
	assert.equal(audacityAutoDuckEnvelope(settings).points[2]?.y, 146);
	assert.deepEqual(audacityAutoDuckEnvelope({ ...settings, thresholdDb: -10, maximumPause: 4 }), audacityAutoDuckEnvelope(settings));
});

test('Classic Filters response evaluates the actual Butterworth transfer function', () => {
	const settings = { family: 'butterworth', direction: 'lowpass', order: 1, cutoffHz: 1000 };
	const lowpass = prepareAudacityClassicFilterResponse(settings, 48_000);
	const highpass = prepareAudacityClassicFilterResponse({ ...settings, direction: 'highpass' }, 48_000);
	assert.ok(Math.abs(gainAt(lowpass, 1000) + 3.0102999566) < 0.01);
	assert.ok(gainAt(lowpass, 20) > -0.01);
	assert.ok(gainAt(lowpass, 10_000) < -20);
	assert.ok(gainAt(highpass, 20) < -30);
	assert.ok(gainAt(highpass, 10_000) > -0.05);
});

test('Classic Filters graph responds to family, ripple, order and project sample rate', () => {
	const settings = { cutoffHz: 2000, order: 4 };
	const butterworth = classicFilterPlot(settings, 48_000);
	const chebyshev = classicFilterPlot({ ...settings, family: 'chebyshev-i', passbandRippleDb: 3 }, 48_000);
	assert.notEqual(chebyshev.line, butterworth.line);
	assert.notEqual(classicFilterPlot({ ...settings, family: 'chebyshev-ii', stopbandAttenuationDb: 50 }, 48_000).line, butterworth.line);
	assert.notEqual(classicFilterPlot({ ...settings, order: 1 }, 48_000).line, butterworth.line);
	assert.notEqual(classicFilterPlot(settings, 96_000).line, butterworth.line);
	assert.equal(butterworth.minimumFrequency, 20);
	assert.equal(butterworth.maximumFrequency, 24_000);
	assert.ok(butterworth.points.every(point => Number.isFinite(point.y) && point.y >= 0 && point.y <= 100));
});
