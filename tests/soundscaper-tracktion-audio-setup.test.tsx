/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { JSDOM } from 'jsdom';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';

import type { TracktionAppliedAudioSetup, TracktionAudioDevices, TracktionAudioHosts, TracktionAudioSetup } from '../src/soundscaper/tracktion-audio-device-contract.ts';
import type { TracktionProjectBridge, TracktionProjectCommand, TracktionProjectReply } from '../src/soundscaper/tracktion-project-contract.ts';
import { TracktionAudioSetupDialog } from '../src/soundscaper/ui/TracktionAudioSetupDialog.tsx';

async function mountSetup(context: TestContext, bridge: TracktionProjectBridge, inventory: TracktionAudioHosts, onDismiss: () => void) {
	const { window } = new JSDOM('<main></main>');
	Object.defineProperties(window.HTMLDialogElement.prototype, {
		showModal: { value(this: HTMLDialogElement) { this.open = true; } },
		close: { value(this: HTMLDialogElement) { this.open = false; } },
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
	await act(async () => root.render(<TracktionAudioSetupDialog inventory={inventory}
		bridge={bridge} sessionId="session" sampleRate={48_000} onDismiss={onDismiss} />));
	function field(name: string): HTMLInputElement | HTMLSelectElement {
		const input = document.querySelector<HTMLInputElement | HTMLSelectElement>(`[name="${name}"]`);
		assert.ok(input, name);
		return input;
	}
	function button(label: string): HTMLButtonElement {
		const element = [...document.querySelectorAll('button')].find((item) => item.textContent === label);
		assert.ok(element, label);
		return element;
	}
	async function click(label: string): Promise<void> {
		assert.equal(button(label).disabled, false, label);
		await act(async () => button(label).click());
	}
	return { document, field, button, click };
}

test('Tracktion Audio Setup preserves the draft through refresh and a save retry', async (context) => {
	const microphone = { id: 'studio-mic', name: 'Studio microphone' };
	const speakers = { id: 'interface', name: 'Audio interface' };
	const headphones = { id: 'headphones', name: 'Headphones' };
	const setup: TracktionAudioSetup = { hostId: 'mock', inputId: microphone.id, outputId: speakers.id,
		inputChannel: 1, outputChannel: 2, sampleRate: 96_000, blockSize: 512 };
	const applied: TracktionAppliedAudioSetup = { setup, actualSampleRate: 96_000, actualBlockSize: 512 };
	const originalInventory: TracktionAudioHosts = { hosts: [{ id: 'mock', name: 'Mock audio host' }], selected: null };
	let inventory = originalInventory;
	let devices: TracktionAudioDevices = { inputs: [microphone], outputs: [speakers], separateDevices: true };
	let preferencesSaved = false;
	let dismissed = 0;
	const requests: TracktionProjectCommand[] = [];
	const bridge: TracktionProjectBridge = {
		async request<Command extends TracktionProjectCommand>(command: Command): Promise<TracktionProjectReply<Command>> {
			requests.push(command);
			if (command.kind === 'audioHosts') return inventory as TracktionProjectReply<Command>;
			assert.ok(command.kind === 'audioDevices' || command.kind === 'setAudioSetup');
			const result = preferencesSaved ? applied : { ...applied, preferencesSaved: false };
			return (command.kind === 'audioDevices' ? devices : result) as TracktionProjectReply<Command>;
		},
	};
	const { document, field, button, click } = await mountSetup(context, bridge, inventory, () => { dismissed += 1; });
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
	inventory = { hosts: [{ id: 'fallback', name: 'Other audio host' }], selected: null };
	devices = { ...devices, outputs: [] };
	await click('Refresh devices');
	assert.equal(field('hostId').value, 'mock');
	assert.equal(document.querySelector('option[value="mock"]')?.textContent, 'Preferred, currently unavailable');
	assert.equal(button('Apply').disabled, true);

	inventory = originalInventory;
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

test('Tracktion Audio Setup refresh can discover the first host after a device connects', async (context) => {
	const initial: TracktionAudioHosts = { hosts: [], selected: null };
	const host = { id: 'pipewire', name: 'PipeWire' };
	const output = { id: 'earphones', name: 'Headphones' };
	const devices: TracktionAudioDevices = { inputs: [], outputs: [output], separateDevices: true };
	const setup: TracktionAudioSetup = { hostId: host.id, inputId: '', outputId: output.id,
		inputChannel: 0, outputChannel: 0, sampleRate: 48_000, blockSize: 0 };
	const applied: TracktionAppliedAudioSetup = { setup, actualSampleRate: 48_000, actualBlockSize: 256 };
	const requests: TracktionProjectCommand[] = [];
	let connected = false;
	let dismissed = false;
	const bridge: TracktionProjectBridge = {
		async request<Command extends TracktionProjectCommand>(command: Command): Promise<TracktionProjectReply<Command>> {
			requests.push(command);
			if (command.kind === 'audioHosts') return (connected ? { ...initial, hosts: [host] } : initial) as TracktionProjectReply<Command>;
			if (command.kind === 'audioDevices') {
				assert.equal(command.hostId, host.id);
				return devices as TracktionProjectReply<Command>;
			}
			assert.equal(command.kind, 'setAudioSetup');
			return applied as TracktionProjectReply<Command>;
		},
	};
	const { document, field, button, click } = await mountSetup(context, bridge, initial, () => { dismissed = true; });
	assert.deepEqual(requests, []);
	assert.ok(document.querySelector('[role="status"]'));
	await click('Refresh devices');
	assert.deepEqual(requests, [{ kind: 'audioHosts', sessionId: 'session' }]);
	assert.ok(document.querySelector('[role="status"]'));
	assert.equal(button('Apply').disabled, true);
	connected = true;
	await click('Refresh devices');
	assert.equal(document.querySelector('[role="status"]'), null);
	assert.equal(field('hostId').value, host.id);
	field('outputId').value = output.id;
	await click('Apply');
	assert.deepEqual(requests.slice(1), [
		{ kind: 'audioHosts', sessionId: 'session' },
		{ kind: 'audioDevices', sessionId: 'session', hostId: host.id },
		{ kind: 'setAudioSetup', sessionId: 'session', ...setup },
	]);
	assert.equal(dismissed, true);
});
