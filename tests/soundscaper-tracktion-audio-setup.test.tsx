/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { JSDOM } from 'jsdom';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';

import type { TracktionAppliedAudioSetup, TracktionAudioDevices, TracktionAudioSetup } from '../src/soundscaper/tracktion-audio-device-contract.ts';
import type { TracktionProjectBridge, TracktionProjectCommand, TracktionProjectReply } from '../src/soundscaper/tracktion-project-contract.ts';
import { TracktionAudioSetupDialog } from '../src/soundscaper/ui/TracktionAudioSetupDialog.tsx';

test('Tracktion Audio Setup preserves the draft through refresh and a save retry', async (context) => {
	const { window } = new JSDOM('<main></main>');
	Object.defineProperty(window.HTMLDialogElement.prototype, 'showModal', {
		value(this: HTMLDialogElement) { this.open = true; },
	});
	const { document } = window;
	const previous = new Map<string, PropertyDescriptor | undefined>();
	for (const [key, value] of Object.entries({ React, window, document, FormData: window.FormData, IS_REACT_ACT_ENVIRONMENT: true })) {
		previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
		Object.defineProperty(globalThis, key, { configurable: true, value });
	}
	const main = document.querySelector('main');
	assert.ok(main);
	const root = createRoot(main);
	context.after(async () => {
		await act(async () => root.unmount());
		window.close();
		for (const [key, descriptor] of previous) {
			if (descriptor) Object.defineProperty(globalThis, key, descriptor);
			else Reflect.deleteProperty(globalThis, key);
		}
	});

	const microphone = { id: 'studio-mic', name: 'Studio microphone' };
	const speakers = { id: 'interface', name: 'Audio interface' };
	const headphones = { id: 'headphones', name: 'Headphones' };
	const setup: TracktionAudioSetup = { hostId: 'mock', inputId: microphone.id, outputId: speakers.id,
		inputChannel: 1, outputChannel: 2, sampleRate: 96_000, blockSize: 512 };
	const applied: TracktionAppliedAudioSetup = { setup, actualSampleRate: 96_000, actualBlockSize: 512 };
	let devices: TracktionAudioDevices = { inputs: [microphone], outputs: [speakers], separateDevices: true };
	let preferencesSaved = false;
	let dismissed = 0;
	const requests: TracktionProjectCommand[] = [];
	const bridge: TracktionProjectBridge = {
		async request<Command extends TracktionProjectCommand>(command: Command): Promise<TracktionProjectReply<Command>> {
			requests.push(command);
			assert.ok(command.kind === 'audioDevices' || command.kind === 'setAudioSetup');
			const result = preferencesSaved ? applied : { ...applied, preferencesSaved: false };
			return (command.kind === 'audioDevices' ? devices : result) as TracktionProjectReply<Command>;
		},
	};
	await act(async () => root.render(<TracktionAudioSetupDialog inventory={{ hosts: [{ id: 'mock', name: 'Mock audio host' }], selected: null }}
		bridge={bridge} sessionId="session" sampleRate={48_000} onDismiss={() => { dismissed += 1; }} />));

	function field(name: string): HTMLInputElement | HTMLSelectElement {
		const input = document.querySelector<HTMLInputElement | HTMLSelectElement>(`[name="${name}"]`);
		assert.ok(input, name);
		return input;
	}
	async function click(label: string): Promise<void> {
		const button = [...document.querySelectorAll('button')].find((item) => item.textContent === label);
		assert.ok(button, label);
		assert.equal(button.disabled, false, label);
		await act(async () => button.click());
	}
	const draft = { inputId: microphone.id, outputId: speakers.id, inputChannel: '2', outputChannel: '3', sampleRate: '96000', blockSize: '512' };
	for (const [name, value] of Object.entries(draft)) field(name).value = value;
	devices = { ...devices, outputs: [speakers, headphones] };
	await click('Refresh devices');
	for (const [name, value] of Object.entries(draft)) assert.equal(field(name).value, value, name);
	assert.ok(document.querySelector('option[value="headphones"]'));

	devices = { ...devices, outputs: [headphones] };
	await click('Refresh devices');
	assert.equal(field('outputId').value, speakers.id);
	assert.equal(document.querySelector('option[value="interface"]')?.textContent, 'Preferred, currently unavailable');
	devices = { ...devices, outputs: [speakers, headphones] };
	await click('Refresh devices');
	await click('Apply');
	assert.deepEqual(requests.at(-1), { kind: 'setAudioSetup', sessionId: 'session', ...setup });
	assert.equal(dismissed, 0);
	assert.match(document.querySelector('[role="alert"]')?.textContent ?? '', /active for this session/u);
	for (const [name, value] of Object.entries(draft)) assert.equal(field(name).value, value, name);
	preferencesSaved = true;
	await click('Apply');
	assert.equal(dismissed, 1);
	assert.equal(document.querySelector('[role="alert"]'), null);
});
