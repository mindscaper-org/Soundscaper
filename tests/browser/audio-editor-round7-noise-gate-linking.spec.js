/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { addRackEffect, bootEditor, chooseDropdown, commitInput, waitForProjectActivation, openEffectsForTrack } from './audio-editor-test-helpers.js';
import { liveEffectToneProject } from './fixtures/live-effect-tone-project.ts';
import { installLiveOutputObserver, waitForLiveOutputObserver } from './helpers/live-output-observer.js';

// Permit the test-only blob worklet without changing the shipped script policy.
test.use({ browserCoverage: false, bypassCSP: true });

test('linking a running Noise gate immediately shares its sounding channel gain', async ({ page }) => {
	await installLiveOutputObserver(page, '__round7GateOutput', { observeMaster: false });
	await page.addInitScript(() => {
		window.__round7GateNodes = [];
		const NativeNode = AudioWorkletNode;
		window.AudioWorkletNode = class extends NativeNode {
			constructor(...args) {
				super(...args);
				if (args[2]?.processorOptions?.type !== 'noise-gate' || !(this.context instanceof AudioContext)) return;
				const observed = { samples: [], linkedAt: null, params: args[2].processorOptions.params, error: null };
				window.__round7GateNodes.push(observed);
				// Playback may construct its effect in a fresh realtime context.
				void globalThis.__prepareLiveOutputObservation(this.context).then(() => {
					globalThis.__observeLiveOutput(this, sample => {
						observed.samples.push({ time: sample.time, rms: sample.channels });
						if (observed.samples.length > 2000) observed.samples.shift();
					});
				}).catch(error => { observed.error = String(error); });
				const post = this.port.postMessage.bind(this.port);
				this.port.postMessage = (...messages) => {
					if (messages[0]?.type === 'configure') observed.params = messages[0].params;
					if (messages[0]?.type === 'configure' && messages[0].params?.stereoLink === 'linked') {
						observed.linkedAt = this.context.currentTime;
					}
					return post(...messages);
				};
			}
		};
	});
	const editor = await bootEditor(page, '/embed/en/');
	const { projectId, file } = await liveEffectToneProject([.6, .006]);
	await editor.locator('[data-aup4-input]').setInputFiles(file);
	await expect(editor).toHaveAttribute('data-project-id', projectId);
	await waitForProjectActivation(editor);
	await waitForLiveOutputObserver(page);
	const panel = await openEffectsForTrack(editor, 0);
	await addRackEffect(page, panel, 'track', 'Noise gate');
	const dialog = page.getByRole('dialog', { name: 'Noise gate', exact: true });
	await commitInput(dialog.locator('[data-effect-param="attack"] input[type="number"]'), '1000');
	const linking = dialog.getByRole('group', { name: 'Stereo linking', exact: true });
	await chooseDropdown(page, linking, 'Independent channels');
	await editor.getByRole('button', { name: 'Play', exact: true }).click();
	await expect.poll(() => page.evaluate(() => {
		const observed = window.__round7GateNodes.at(-1);
		if (observed?.error) throw new Error(observed.error);
		return observed?.samples.at(-1)?.rms[0] ?? 0;
	})).toBeGreaterThan(.4);
	expect(await page.evaluate(() => window.__round7GateNodes.at(-1).params.attack)).toBe(1);
	const before = await page.evaluate(() => window.__round7GateNodes.at(-1).samples.at(-1).rms);
	expect(before[1] / before[0]).toBeLessThan(.001);
	const count = await page.evaluate(() => window.__round7GateNodes.length);
	await chooseDropdown(page, linking, 'Link channels');
	await expect.poll(() => page.evaluate(() => {
		const observed = window.__round7GateNodes.at(-1);
		return observed?.linkedAt !== null && observed?.samples.at(-1)?.time > observed.linkedAt + .35;
	})).toBe(true);
	const ratios = await page.evaluate(() => {
		const observed = window.__round7GateNodes.at(-1);
		return observed.samples.filter(sample => sample.time > observed.linkedAt + .15 && sample.time < observed.linkedAt + .35)
			.map(sample => sample.rms[1] / sample.rms[0]);
	});
	expect(ratios.length).toBeGreaterThan(4);
	console.log('ordinary Noise gate relinking native channel ratios', { before: before[1] / before[0], minimum: Math.min(...ratios), maximum: Math.max(...ratios) });
	expect(Math.min(...ratios)).toBeGreaterThan(.009);
	expect(Math.max(...ratios)).toBeLessThan(.011);
	expect(await page.evaluate(() => window.__round7GateNodes.length)).toBe(count);
	await editor.getByRole('button', { name: 'Stop', exact: true }).click();
});
