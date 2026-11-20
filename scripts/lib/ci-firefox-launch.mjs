/* SPDX-License-Identifier: AGPL-3.0-only */

import { firefox } from '@playwright/test';
import { fileURLToPath } from 'node:url';

/** @returns {import('@playwright/test').LaunchOptions & { headless: boolean }} */
export function ciFirefoxLaunchOptions() {
	if (process.env.SCAPE_FIREFOX_XVFB !== '1') return { headless: true };
	return {
		headless: false,
		executablePath: fileURLToPath(new URL('../ci-firefox-xvfb.sh', import.meta.url)),
		env: { ...process.env, SCAPE_FIREFOX_EXECUTABLE: firefox.executablePath() },
	};
}
