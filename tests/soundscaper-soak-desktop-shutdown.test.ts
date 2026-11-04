/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';

import { prepareSoundscaperDesktopSoakPreferences, quitDesktopRuntime } from '../scripts/lib/soundscaper-soak-desktop-playwright.mjs';

test('packaged soak opts its disposable profile out of native save prompts before project workflows and quit', async () => {
	const calls: string[] = [];
	let prompting = true;
	const child = Object.assign(new EventEmitter(), { exitCode: null as number | null, signalCode: null });
	const locator = (name: string) => ({
		getByRole: (_role: string, options: { name?: string | RegExp } = {}) => locator(String(options.name ?? 'button')),
		last: () => locator(name),
		async click() {
			calls.push(name);
			if (name === 'Off') prompting = false;
			if (name === '[data-window-control="quit"]') {
				assert.equal(prompting, false, 'a native Save/Discard/Cancel dialog would block shutdown');
				child.exitCode = 0;
				child.emit('exit', 0, null);
			}
		},
	});
	const page = {
		locator,
		getByRole: (_role: string, options: { name: string | RegExp }) => locator(String(options.name)),
	};
	await prepareSoundscaperDesktopSoakPreferences(page);
	await quitDesktopRuntime({ page, child });
	assert.deepEqual(calls, ['Edit', '/^Preferences(?:\\s|$)/u', '/General$/u', 'button', 'Off', 'Close', '[data-window-control="quit"]']);
});
