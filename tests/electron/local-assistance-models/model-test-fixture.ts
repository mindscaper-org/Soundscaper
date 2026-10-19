/* SPDX-License-Identifier: AGPL-3.0-only */

import type { PlaywrightTestOptions, TestFixture, TestInfo } from '@playwright/test';

interface ModelTestElectron {
	close(): Promise<void>;
}

/** Playwright owns teardown even when a native operation never settles. */
export function createModelTestElectronFixture<Host extends ModelTestElectron>(
	launch: (testInfo: TestInfo) => Promise<Host>,
): TestFixture<() => Promise<Host>, PlaywrightTestOptions> {
	return async ({ browserName: _browserName }, use, testInfo) => {
		let host: Promise<Host> | null = null;
		try {
			await use(() => host ??= launch(testInfo));
		} finally {
			if (host !== null) await (await host).close();
		}
	};
}
