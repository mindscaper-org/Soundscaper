#!/usr/bin/env node
/* SPDX-License-Identifier: AGPL-3.0-only */

import { firefox } from '@playwright/test';
import { ciFirefoxLaunchOptions } from './lib/ci-firefox-launch.mjs';

const browser = await firefox.launch(ciFirefoxLaunchOptions());
try {
	const page = await browser.newPage();
	const webgl2 = await page.evaluate(() => Boolean(document.createElement('canvas').getContext('webgl2')));
	if (!webgl2) throw new Error('Firefox could not create a WebGL2 context on the CI display.');
	await page.setContent(`
		<button id="start" type="button">Start audio</button>
		<script>
			document.querySelector('#start').addEventListener('click', () => {
				globalThis.__soundscaperAudioClockProbe = (async () => {
					const context = new AudioContext({ latencyHint: 'interactive', sampleRate: 48_000 });
					const oscillator = context.createOscillator();
					const gain = context.createGain();
					gain.gain.value = 0;
					oscillator.connect(gain).connect(context.destination);
					oscillator.start();
					const probe = async () => {
						const initialTime = context.currentTime;
						const started = performance.now();
						const resumeResult = await Promise.race([
							context.resume().then(() => 'resumed'),
							new Promise((resolve) => setTimeout(() => resolve('timed-out'), 5_000)),
						]);
						const resumeMilliseconds = performance.now() - started;
						const deadline = performance.now() + 5_000;
						while (context.currentTime - initialTime < 0.05 && performance.now() < deadline) {
							await new Promise((resolve) => setTimeout(resolve, 50));
						}
						return {
							advance: context.currentTime - initialTime,
							resumeResult,
							resumeMilliseconds,
							state: context.state,
						};
					};
					const result = await probe();
					const restarts = [];
					for (let cycle = 0; cycle < 3; cycle += 1) {
						await context.suspend();
						restarts.push(await probe());
					}
					oscillator.stop();
					await context.close();
					return { ...result, restarts };
				})();
			});
		</script>
	`);
	if (process.env.SCAPE_FIREFOX_XVFB === '1') {
		await page.getByRole('button', { name: 'Start audio', exact: true }).focus();
		const sibling = await firefox.launch(ciFirefoxLaunchOptions());
		try {
			const secondPage = await sibling.newPage();
			await secondPage.setContent('<button type="button">Focus</button>');
			await secondPage.getByRole('button', { name: 'Focus', exact: true }).focus();
			const checkFocus = () => document.hasFocus() && document.activeElement?.tagName === 'BUTTON';
			await Promise.all([page, secondPage].map(active => active.waitForFunction(checkFocus, undefined, { timeout: 5_000 })));
		} finally {
			await sibling.close();
		}
	}
	await page.getByRole('button', { name: 'Start audio', exact: true }).click();
	const result = await withTimeout(
		page.evaluate(() => globalThis.__soundscaperAudioClockProbe),
		45_000,
		'Firefox AudioContext clock probe timed out.',
	);
	if (result.resumeResult !== 'resumed' || result.state !== 'running' || result.advance < 0.05) {
		throw new Error(
			`Firefox AudioContext clock did not advance on PulseAudio: ${JSON.stringify(result)}`,
		);
	}
	if (result.restarts.some((restart) => (
		restart.resumeResult !== 'resumed' || restart.state !== 'running'
		|| restart.advance < 0.05 || restart.resumeMilliseconds >= 1_000
	))) {
		throw new Error(`Firefox AudioContext restarts were not responsive on PulseAudio: ${JSON.stringify(result)}`);
	}
	const maximumRestartMilliseconds = Math.max(...result.restarts.map((restart) => restart.resumeMilliseconds));
	console.log(`Firefox AudioContext advanced ${result.advance.toFixed(3)} seconds on PulseAudio; restarts took at most ${maximumRestartMilliseconds.toFixed(0)} ms.`);
} finally {
	await browser.close();
}

async function withTimeout(operation, milliseconds, message) {
	let timeoutId;
	const timeout = new Promise((_resolve, reject) => {
		timeoutId = setTimeout(() => reject(new Error(message)), milliseconds);
	});
	try {
		return await Promise.race([operation, timeout]);
	} finally {
		clearTimeout(timeoutId);
	}
}
