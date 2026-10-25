/* SPDX-License-Identifier: AGPL-3.0-only */

export const PARALLEL_STACK_COPY_BY_LOCALE = Object.freeze({
	en: Object.freeze({
		audioSetup: 'Audio setup',
		processing: 'Processing',
		enabled: 'Parallel effect stacks',
		workers: 'Worker limit',
		auto: 'Automatic',
		workerCount: '{count} workers',
		buffering: 'Buffering',
		standard: 'Lower latency',
		additional: 'Recommended',
		latency: 'Added latency: {milliseconds} ms at {sampleRate} Hz',
		latencyUnknown: 'Added latency: {frames} samples',
		stopRequired: 'Stop playback and recording to change processing settings.',
		off: 'Parallel processing is off',
		ready: 'Ready for the next playback',
		active: 'Parallel processing: {count} workers active',
		unsupported: 'Using standard processing: {reason}',
		failed: 'Parallel processing stopped: {reason}. Next playback uses standard processing.',
	}),
});
