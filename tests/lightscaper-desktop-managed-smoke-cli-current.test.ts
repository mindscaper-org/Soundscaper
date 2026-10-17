/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { runLightscaperDesktopManagedSmokeCurrentV1 } from '../scripts/lightscaper-desktop-managed-smoke-current-v1.ts';

test('Lightscaper managed qualification rejects incomplete, duplicate and relative authorities before launch', async () => {
	for (const args of [[], ['--unknown'], ['--executable', 'relative'], ['--allow-no-sandbox', '--allow-no-sandbox'],
		['--executable', '/fixture/app', '--executable', '/fixture/other']]) {
		await assert.rejects(runLightscaperDesktopManagedSmokeCurrentV1(args));
	}
});
