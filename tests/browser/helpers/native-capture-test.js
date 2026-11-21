/* SPDX-License-Identifier: AGPL-3.0-only */

import { test as base } from '../audio-editor-test-fixtures.js';

export const test = base.extend({
	nativeCaptureChromiumArgs: [[], { scope: 'worker', option: true }],
	launchOptions: [async ({ browserName, launchOptions, nativeCaptureChromiumArgs }, use) => {
		if (browserName === 'firefox') {
			await use({ ...launchOptions, firefoxUserPrefs: {
				...launchOptions.firefoxUserPrefs,
				'media.navigator.streams.fake': true,
				'media.navigator.permission.disabled': true,
			} });
		} else {
			await use(nativeCaptureChromiumArgs.length && browserName === 'chromium'
				? { ...launchOptions, args: [...(launchOptions.args ?? []), ...nativeCaptureChromiumArgs] } : launchOptions);
		}
	}, { scope: 'worker' }],
});
