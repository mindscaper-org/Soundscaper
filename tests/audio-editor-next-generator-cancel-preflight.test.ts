/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createAudioGeneratorService } from '../src/common/editor/controller/edit/generator-service.ts';
import { createFixture } from './helpers/audio-editor-generator-service-fixture.ts';
import { deferred, settle } from './helpers/async-test-control.ts';

// The storage manager owns its estimate Promise and offers no abort API.
test('cancelling a signal generator retires its pending storage estimate before it returns', async () => {
	const started = deferred<void>();
	const estimate = deferred<void>();
	const fixture = createFixture({ preflightStorage: async () => {
		started.resolve(); await estimate.promise;
	} });
	const cancellation = new AbortController();
	const service = createAudioGeneratorService(fixture.dependencies);
	const outcome = service.generateSignal('tone', { durationSeconds: 0.01, frequency: 100, signal: cancellation.signal })
		.then(() => null, (error: unknown) => error);
	await started.promise;
	assert.equal(fixture.state.audacityEffectProcessing, true);
	cancellation.abort(new DOMException('The generator was cancelled.', 'AbortError'));
	await settle();
	try {
		assert.equal(fixture.state.audacityEffectProcessing, false, 'Cancel must release editing while the browser storage estimate is pending');
		assert.equal(fixture.commits.length, 0);
	} finally { estimate.resolve(); }
	const failure = await outcome;
	assert.ok(failure instanceof DOMException);
	assert.equal(failure.name, 'AbortError');
	assert.equal(fixture.commits.length, 0, 'a late estimate cannot publish cancelled generated audio');
});
