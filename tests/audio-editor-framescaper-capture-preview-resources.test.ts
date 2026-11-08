/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createBrowserFramescaperCaptureLevelMonitor,
	createBrowserFramescaperCapturePreviewSurface,
} from '../src/common/editor/controller/capture/internal/browser/framescaper-browser-capture-preview.ts';

test('browser video preview uses the live stream and owns no synthetic object URL', async () => {
	const stream = { id: 'camera-stream' };
	const surface = createBrowserFramescaperCapturePreviewSurface({
		sourceId: 'camera', role: 'camera', stream, track: {}, settings: {}, capabilities: {},
	});
	assert.equal(surface.stream, stream);
	assert.equal(surface.url, null);
	await surface.dispose();
	await surface.dispose();
});

test('browser audio level monitor reports RMS without connecting to output and releases exactly', async () => {
	let sample: (() => void) | null = null;
	let clears = 0;
	let closes = 0;
	let resumes = 0;
	let sourceDisconnects = 0;
	let analyserDisconnects = 0;
	let notifications = 0;
	let sampledFrames = 0;
	const analyser = {
		fftSize: 0,
		frequencyBinCount: 4,
		getFloatTimeDomainData(values: Float32Array) {
			sampledFrames = values.length;
			values.fill(0.5);
		},
		disconnect() { analyserDisconnects += 1; },
	};
	const monitor = await createBrowserFramescaperCaptureLevelMonitor({
		sourceId: 'microphone', role: 'microphone', stream: { id: 'microphone-stream' },
		track: {}, settings: {}, capabilities: {},
	}, () => { notifications += 1; }, {
		createAudioContext: () => ({
			state: 'suspended',
			createMediaStreamSource: () => ({
				connect(value: unknown) { assert.equal(value, analyser); },
				disconnect() { sourceDisconnects += 1; },
			}),
			createAnalyser: () => analyser,
			async resume() { resumes += 1; },
			async close() { closes += 1; },
		}),
		setInterval(callback) { sample = callback; return 17; },
		clearInterval(timer) { assert.equal(timer, 17); clears += 1; },
	});

	assert.equal(resumes, 1);
	assert.equal(monitor.level, null);
	assert.ok(sample);
	(sample as () => void)();
	assert.equal(sampledFrames, 2_048);
	assert.equal(monitor.level, 0.5);
	assert.equal(notifications, 1);
	await monitor.dispose();
	await monitor.dispose();
	assert.deepEqual({ clears, closes, sourceDisconnects, analyserDisconnects }, {
		clears: 1, closes: 1, sourceDisconnects: 1, analyserDisconnects: 1,
	});
});

test('stereo capture preview measures channel energy without opposite-polarity cancellation', async () => {
	let sample: (() => void) | undefined;
	let splitterDisconnects = 0;
	let analyserDisconnects = 0;
	interface MeterNode { readonly kind: 'analyser' | 'splitter'; level?: number }
	function assertNode(value: unknown): asserts value is MeterNode {
		assert.ok(value && typeof value === 'object' && 'kind' in value && (value.kind === 'analyser' || value.kind === 'splitter'));
	}
	const splitter = {
		kind: 'splitter' as const,
		connect(destination: unknown, channel = 0) { assertNode(destination); destination.level = channel === 0 ? 0.5 : -0.5; },
		disconnect() { splitterDisconnects += 1; },
	};
	const monitor = await createBrowserFramescaperCaptureLevelMonitor({
		sourceId: 'stereo-system', role: 'system-audio', stream: {}, track: {}, settings: { channelCount: 2 }, capabilities: {},
	}, () => undefined, {
		createAudioContext: () => ({ state: 'running',
			createMediaStreamSource: () => ({ connect(destination: unknown) {
				assertNode(destination);
				if (destination.kind === 'analyser') destination.level = 0; // Web Audio's L+R downmix cancels this admitted stereo input.
			}, disconnect() {} }),
			createChannelSplitter: () => splitter,
			createAnalyser: () => { const analyser = { kind: 'analyser' as const, level: 0, fftSize: 0, frequencyBinCount: 1024,
				getFloatTimeDomainData(values: Float32Array) { values.fill(this.level); },
				disconnect() { analyserDisconnects += 1; },
			}; return analyser; },
			async close() {},
		}),
		setInterval(callback) { sample = callback; return 1; }, clearInterval() {},
	});
	assert.ok(sample);
	sample();
	assert.equal(monitor.level, 0.5, 'audible recorded stereo must retain its input level even when left and right cancel in mono');
	await monitor.dispose();
	assert.equal(splitterDisconnects, 1);
	assert.equal(analyserDisconnects, 2);
});
