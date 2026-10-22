/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createGroupedEditorActions } from '../src/common/editor/controller/composition/action-facade.ts';
import { createActionFacadeRuntime } from './helpers/action-facade-runtime-fixture.ts';

test('default-view changes persist the preference and update the active view before finishing', async () => {
	const calls: unknown[][] = [];
	let resolveUpdate: (() => void) | undefined;
	const updated = new Promise<void>((resolve) => { resolveUpdate = resolve; });
	const runtime = createActionFacadeRuntime();
	const actions = createGroupedEditorActions(new Proxy(runtime, {
		get(target, name, receiver) {
			if (name === 'updatePreferences') return (patch: unknown) => { calls.push(['update', patch]); return updated; };
			if (name === 'setTimelineView') return (view: unknown) => { calls.push(['view', view]); };
			return Reflect.get(target, name, receiver);
		},
	})).preferences;
	const changed = actions.setDefaultView('spectrogram');
	assert.deepEqual(calls, [['update', { appearance: { defaultView: 'spectrogram' } }], ['view', 'spectrogram']]);
	resolveUpdate?.();
	assert.equal(await changed, await updated);
});
