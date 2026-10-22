/* SPDX-License-Identifier: AGPL-3.0-only */

import type { PlaywrightTestOptions, PlaywrightWorkerOptions, TestFixture, TestInfo } from '@playwright/test';

interface ModelTestElectron {
	close(): Promise<void>;
}

/** Playwright owns teardown even when a native operation never settles. */
export function createModelTestElectronFixture<Host extends ModelTestElectron>(
	launch: (testInfo: TestInfo) => Promise<Host>,
): TestFixture<() => Promise<Host>, PlaywrightTestOptions & Pick<PlaywrightWorkerOptions, 'browserName'>> {
	return async ({ browserName: _browserName }, use, testInfo) => {
		const host: { pending: Promise<Host> | null } = { pending: null };
		try {
			await use(() => host.pending ??= launch(testInfo));
		} finally {
			if (host.pending !== null) await (await host.pending).close();
		}
	};
}
