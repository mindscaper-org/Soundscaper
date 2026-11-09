/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { runDirectWavRendererSmoke } from '../desktop/direct-wav-renderer-smoke.js';
import { createRendererScope } from './helpers/desktop-direct-wav-renderer-scope.js';

const PLAN = Object.freeze({
	schemaVersion: 1,
	mode: 'direct-wav-export-v1',
	productId: 'soundscaper',
	token: '0123456789abcdef0123456789abcdef',
});

interface SmokeControl {
	click(): void;
	getAttribute(name: string): string | null;
	querySelector(selector: string): SmokeControl | null;
}

interface SmokeDocument {
	fixture: { cancelledRuns: number; completedRuns: number };
	querySelector(selector: string): SmokeControl | null;
}

for (const disabledAttribute of ['disabled', 'aria-disabled'] as const) {
	test(`packaged export waits for ${disabledAttribute} controls after cancellation`, async () => {
		const scope = createRendererScope() as ReturnType<typeof createRendererScope> & { document: SmokeDocument };
		const documentQuery = scope.document.querySelector.bind(scope.document);
		let blockedClicks = 0;
		let enabledClicks = 0;
		let remainingTicks = 0;
		let armed = false;
		const schedule = scope.setTimeout;
		scope.setTimeout = (callback, milliseconds) => {
			if (remainingTicks > 0) remainingTicks -= 1;
			return schedule(callback, milliseconds);
		};
		scope.document.querySelector = (selector) => {
			const dialog = documentQuery(selector);
			if (selector !== '[data-export-dialog]' || !dialog) return dialog;
			return new Proxy(dialog, {
				get(target, property, receiver) {
					if (property !== 'querySelector') return Reflect.get(target, property, receiver);
					return (controlSelector: string) => {
						const control = target.querySelector(controlSelector);
						if (controlSelector !== '[data-export-field="format"] button' || !control) return control;
						if (!armed && scope.document.fixture.cancelledRuns === 1) {
							armed = true;
							remainingTicks = 3;
						}
						return new Proxy(control, {
							get(button, key, buttonReceiver) {
								if (key === 'disabled') return disabledAttribute === 'disabled' && remainingTicks > 0;
								if (key === 'getAttribute') return (name: string) => name === 'aria-disabled'
									? String(disabledAttribute === 'aria-disabled' && remainingTicks > 0) : button.getAttribute(name);
								if (key === 'click') return () => {
									if (remainingTicks > 0) {
										blockedClicks += 1;
										throw new Error('Export format clicked before submission settled');
									}
									enabledClicks += 1;
									button.click();
								};
								return Reflect.get(button, key, buttonReceiver);
							},
						});
					};
				},
			});
		};

		const result = await runDirectWavRendererSmoke(scope, PLAN);
		assert.ok('aiffCompleted' in result);
		assert.equal(armed, true);
		assert.equal(blockedClicks, 0);
		assert.ok(enabledClicks >= 2);
		assert.equal(result.aiffCompleted, true);
		assert.equal(result.bwfCompleted, true);
		assert.equal(result.bw64Completed, true);
		assert.equal(scope.document.fixture.completedRuns, 4);
		assert.equal(scope.document.fixture.cancelledRuns, 1);
	});
}
