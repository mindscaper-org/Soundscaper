/* SPDX-License-Identifier: AGPL-3.0-only */

import { createWavFixture, expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, clipByName, closeWorkspacePanel, importFiles, openSourceMonitor } from './audio-editor-test-helpers.js';
import { installNativeOutputPeer } from './helpers/native-output-peer.js';

for (const audition of ['source', 'bin']) test(`native ${audition} audition follows rate replacement and preserves the main context on retirement`, async ({ page }) => {
	await installAuditionProbe(page);
	const editor = await bootEditor(page, '/embed/en/');
	const recording = createWavFixture({ name: 'Native audition.wav', sampleRate: 16000, frequency: 440, duration: 12, channelCount: 1 });
	await importFiles(editor, [recording]);
	await editor.getByRole('button', { name: 'Audio setup', exact: true }).click();
	let setup = editor.getByRole('dialog', { name: 'Audio setup', exact: true });
	await setup.getByRole('combobox', { name: 'Host', exact: true }).selectOption('alsa');
	await expect(setup.getByRole('combobox', { name: 'Speakers', exact: true })).toBeEnabled();
	await page.keyboard.press('Escape');
	await editor.getByRole('button', { name: 'Play', exact: true }).click();
	await expect.poll(() => nativeRms(page)).toBeGreaterThan(.05);
	await editor.getByRole('button', { name: 'Stop', exact: true }).click();
	await expectNativeStopped(page);
	const clip = clipByName(editor, recording.name);
	let source, card;
	if (audition === 'source') {
		source = await openSourceMonitor(page, editor, clip);
		await source.getByRole('button', { name: 'Play', exact: true }).click();
		await expect(source.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
	} else {
		await clip.locator('.clip-header').click({ button: 'right' });
		await page.getByRole('menuitem', { name: 'Move to Project bin', exact: true }).click();
		card = editor.locator('[data-project-bin-item]').first();
		await card.getByRole('button', { name: /^Play:/u }).click();
		await expect(card.getByRole('button', { name: /^Pause:/u })).toBeVisible();
	}
	await expect.poll(() => nativeRms(page)).toBeGreaterThan(.05);
	expect(await page.evaluate(() => Math.max(0, ...window.__nativeAuditionProof.outputs.map(output => output.peak)))).toBeLessThan(.0001);
	await editor.getByRole('button', { name: 'Audio setup', exact: true }).click();
	setup = editor.getByRole('dialog', { name: 'Audio setup', exact: true });
	const rate = setup.getByRole('combobox', { name: 'Recording sample rate', exact: true });
	await rate.selectOption('44100');
	await expect(rate).toHaveValue('44100');
	await expect(rate).toBeEnabled();
	await expect.poll(() => page.evaluate(() => window.__nativeAuditionProof.contexts.filter(context => context.state !== 'closed').map(context => context.sampleRate))).toEqual([44100]);
	await expect.poll(() => nativeRms(page)).toBeGreaterThan(.05);
	await page.keyboard.press('Escape');
	if (source) {
		await expect(source.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
		await source.getByRole('button', { name: 'Stop', exact: true }).click();
		await closeWorkspacePanel(editor, 'source-monitor');
	} else {
		await card.getByRole('button', { name: /^Pause:/u }).click();
		await card.getByRole('button', { name: /^Add to timeline:/u }).click();
	}
	await expectNativeStopped(page);
	await editor.getByRole('button', { name: 'Play', exact: true }).click();
	await expect.poll(() => nativeRms(page)).toBeGreaterThan(.05);
	expect(await page.evaluate(() => window.__nativeAuditionProof.contexts.filter(context => context.state !== 'closed').map(context => context.sampleRate))).toEqual([44100]);
	await expect(editor.getByRole('alert')).toHaveCount(0);
});

async function nativeRms(page) {
	return page.evaluate(() => Math.max(0, ...window.__nativeOutput.channelRms));
}

async function expectNativeStopped(page) {
	const fence = await page.evaluate(async () => {
		// Read the worker's packet origin, rather than delayed UI telemetry.
		const snapshot = await window.__nativeOutput.fence();
		const context = window.__nativeAuditionProof.contexts.find(candidate => candidate.state === 'running' && !candidate.__fixtureCapture);
		if (!context) throw new Error('A live native packet clock is required.');
		// At most the attached transport's owned packet pool can still precede
		// Stop. Allow that exact bound plus one unfinished Web Audio quantum.
		const budget = snapshot.queueCapacity * snapshot.periodFrames + 128;
		return { frame: (snapshot.packet?.endFrame ?? 0) + budget, sessionId: snapshot.sessionId, clock: context.currentTime * context.sampleRate,
			advance: budget * 2, index: window.__nativeAuditionProof.contexts.indexOf(context) };
	});
	await expect.poll(() => page.evaluate(({ index, clock }) => {
		const context = window.__nativeAuditionProof.contexts[index];
		return context.currentTime * context.sampleRate - clock;
	}, fence)).toBeGreaterThan(fence.advance);
	await page.evaluate(() => window.__nativeOutput.fence());
	const later = await page.evaluate(({ frame, sessionId }) => window.__nativeOutput.packetHistory
		.filter(packet => packet.sessionId === sessionId && packet.startFrame >= frame), fence);
	expect(later.every(packet => packet.peaks.every(peak => peak < .0001)), 'Stop may retire packets entirely or continue emitting silence').toBe(true);
}

test('Source native-to-browser fallback matches the same surround programme played directly in the browser', async ({ page }) => {
	await installAuditionProbe(page, { browserInput: true });
	const editor = await bootEditor(page, '/embed/en/');
	const recording = createWavFixture({ name: 'Rear programme.wav', sampleRate: 16000, frequency: 440, duration: 12,
		channelCount: 6, channelAmplitudes: [0, 0, 0, 0, .4, 0] });
	await importFiles(editor, [recording]);
	const source = await openSourceMonitor(page, editor, clipByName(editor, recording.name));
	await source.getByRole('button', { name: 'Play', exact: true }).click();
	await expect.poll(() => browserPeak(page)).toBeGreaterThan(.01);
	const controlPeak = await browserPeak(page);
	await editor.getByRole('button', { name: 'Audio setup', exact: true }).click();
	const setup = editor.getByRole('dialog', { name: 'Audio setup', exact: true });
	await setup.getByRole('combobox', { name: 'Host', exact: true }).selectOption('alsa');
	await expect(setup.getByRole('combobox', { name: 'Speakers', exact: true })).toBeEnabled();
	await page.evaluate(() => { window.__nativeAuditionProof.outputs.forEach(output => { output.peak = 0; }); });
	await expect.poll(() => nativeRms(page)).toBeGreaterThan(.01);
	expect(await browserPeak(page)).toBeLessThan(.0001);
	const ownerIndex = await page.evaluate(() => window.__nativeAuditionProof.contexts.findIndex(context => context.state !== 'closed' && !context.__fixtureCapture));
	await setup.getByRole('combobox', { name: 'Host', exact: true }).selectOption('electron');
	await expect(setup.getByRole('combobox', { name: 'Host', exact: true })).toBeEnabled();
	await expect.poll(() => browserPeak(page)).toBeGreaterThan(.01);
	expect(Math.abs(await browserPeak(page) - controlPeak)).toBeLessThan(.0002);
	await page.keyboard.press('Escape');
	await source.getByRole('button', { name: 'Stop', exact: true }).click();
	await closeWorkspacePanel(editor, 'source-monitor');
	expect(await page.evaluate(index => window.__nativeAuditionProof.contexts[index].state, ownerIndex)).not.toBe('closed');
	await expect(editor.getByRole('alert')).toHaveCount(0);
});

async function browserPeak(page) {
	return page.evaluate(() => Math.max(0, ...window.__nativeAuditionProof.outputs.map(output => output.peak)));
}

async function installAuditionProbe(page, { browserInput = false } = {}) {
	await installNativeOutputPeer(page);
	await page.addInitScript(({ browserInput }) => {
		window.__nativeAuditionProof = { contexts: [], outputs: [] };
		const OriginalContext = AudioContext;
		window.AudioContext = new Proxy(OriginalContext, { construct(target, args, newTarget) {
			const context = Reflect.construct(target, args, newTarget);
			window.__nativeAuditionProof.contexts.push(context);
			return context;
		} });
		if (browserInput) Object.defineProperty(navigator.mediaDevices, 'getUserMedia', { configurable: true, value: async () => {
			const context = new AudioContext(); context.__fixtureCapture = true;
			const destination = context.createMediaStreamDestination();
			const oscillator = context.createOscillator(); oscillator.connect(destination); oscillator.start();
			await context.resume();
			return destination.stream;
		} });
		const connect = AudioNode.prototype.connect;
		AudioNode.prototype.connect = function (destination, ...ports) {
			const result = Reflect.apply(connect, this, [destination, ...ports]);
			if (destination === this.context.destination && this.context instanceof OriginalContext) {
				const analyser = this.context.createAnalyser(); analyser.fftSize = 2048;
				Reflect.apply(connect, this, [analyser, ...ports]);
				const output = { peak: 0, context: this.context }; window.__nativeAuditionProof.outputs.push(output);
				const samples = new Float32Array(analyser.fftSize);
				const timer = setInterval(() => {
					if (this.context.state === 'closed') { clearInterval(timer); return; }
					analyser.getFloatTimeDomainData(samples);
					output.peak = Math.max(output.peak, samples.reduce((peak, value) => Math.max(peak, Math.abs(value)), 0));
				}, 20);
			}
			return result;
		};
	}, { browserInput });
}
