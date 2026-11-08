/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor } from './audio-editor-test-helpers.js';
import { selectSourceRoles, expectCapturePhase } from './helpers/framescaper-capture-harness.js';

// Skip before page/browser setup: WebKit rejects Chromium's device flags.
test.skip(({ browserName }) => browserName !== 'chromium', 'Chromium provides the qualified fake-hardware speaker inventory.');
test.use({ launchOptions: { args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] } });

for (const sourceRate of [48_000, 44_100]) test(`capture monitoring follows Speakers changes at ${sourceRate} Hz without interrupting capture`, async ({ page }) => {
	// These are real Chromium audio-device IDs and real AudioContext.setSinkId calls.
	await page.context().grantPermissions(['microphone']);
	await installCaptureToneAndMonitorObserver(page, sourceRate);
	const editor = await bootEditor(page, '/framescaper/en/');
	await editor.getByRole('button', { name: 'Inputs setup', exact: true }).click();
	const dialog = editor.getByRole('dialog', { name: 'Inputs setup', exact: true });
	await dialog.getByRole('button', { name: 'Refresh devices', exact: true }).click();
	const speakers = dialog.getByRole('combobox', { name: 'Speakers', exact: true });
	await expect(speakers).toBeEnabled();
	const first = await speakers.getByRole('option', { name: 'Fake Audio Output 1', exact: true }).getAttribute('value');
	const second = await speakers.getByRole('option', { name: 'Fake Audio Output 2', exact: true }).getAttribute('value');
	expect(first).toBeTruthy();
	expect(second).toBeTruthy();
	await speakers.selectOption(first);
	const panel = dialog.locator('[data-framescaper-recording-setup]');
	await selectSourceRoles(panel, ['microphone']);
	await panel.getByRole('button', { name: 'Preview sources', exact: true }).click();
	await expectCapturePhase(panel, 'previewing');
	await panel.getByRole('combobox', { name: 'Countdown', exact: true }).selectOption('0');
	await panel.getByRole('checkbox', { name: 'Monitor microphone', exact: true }).check();
	await panel.getByRole('button', { name: 'Arm capture', exact: true }).click();
	await expectCapturePhase(panel, 'armed');
	await panel.getByRole('button', { name: 'Start capture', exact: true }).click();
	await expectCapturePhase(panel, 'recording');
	await expect.poll(() => audibleRoutes(page)).toEqual([first]);
	await expect(speakers).toBeEnabled();
	await speakers.selectOption(second);
	await expect(speakers).toHaveValue(second);
	await expect.poll(() => audibleRoutes(page)).toEqual([second]);
	await expectCapturePhase(panel, 'recording');
	await panel.getByRole('button', { name: 'Stop and import', exact: true }).click();
	await expectCapturePhase(panel, 'inactive', 30_000);
});

function audibleRoutes(page) {
	return page.evaluate(() => globalThis.__captureMonitorRoutes()
		.filter(route => route.state === 'running' && route.peak > 0.1).map(route => route.sink));
}

async function installCaptureToneAndMonitorObserver(page, sourceRate) {
	await page.addInitScript(({ sourceRate }) => {
		const outputs = [];
		const inputs = [];
		const connect = AudioNode.prototype.connect;
		AudioNode.prototype.connect = function (...args) {
			const result = Reflect.apply(connect, this, args);
			if (args[0] === this.context.destination) {
				const analyser = this.context.createAnalyser();
				analyser.fftSize = 2_048;
				Reflect.apply(connect, this, [analyser]);
				outputs.push({ context: this.context, analyser });
			}
			return result;
		};
		const mediaDevices = navigator.mediaDevices;
		Object.defineProperty(mediaDevices, 'getUserMedia', { configurable: true, value: async () => {
			const context = new AudioContext({ sampleRate: sourceRate });
			const oscillator = context.createOscillator();
			const gain = context.createGain();
			const destination = context.createMediaStreamDestination();
			oscillator.frequency.value = 440;
			gain.gain.value = 0.2;
			oscillator.connect(gain).connect(destination);
			oscillator.start();
			await context.resume();
			inputs.push({ context, oscillator, gain, destination });
			return destination.stream;
		} });
		globalThis.__captureMonitorRoutes = () => outputs.map(({ context, analyser }) => {
			const values = new Float32Array(analyser.fftSize);
			analyser.getFloatTimeDomainData(values);
			return { rate: context.sampleRate, sink: context.sinkId, state: context.state,
				peak: Math.max(...values.map(Math.abs)) };
		});
	}, { sourceRate });
}
