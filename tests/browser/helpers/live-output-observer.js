/* SPDX-License-Identifier: AGPL-3.0-only */

import { readFile } from 'node:fs/promises';

export async function installLiveOutputObserver(page, property, { observeMaster = true } = {}) {
	const body = await readFile(new URL('../fixtures/live-output-observer.worklet.js', import.meta.url), 'utf8');
	// Chromium does not route these worklet requests; WebKit requires an HTTP URL.
	const routedPath = page.context().browser().browserType().name() === 'chromium'
		? null : '/__test__/live-output-observer.worklet.js';
	if (routedPath) await page.route(`**${routedPath}`, route => route.fulfill({ contentType: 'text/javascript', body }));
	await page.addInitScript(({ body, routedPath, property, observeMaster }) => {
		const path = routedPath ?? URL.createObjectURL(new Blob([body], { type: 'text/javascript' }));
		const samples = [];
		globalThis[property] = samples;
		const modules = new WeakMap(), pending = [], observers = [];
		globalThis.__liveOutputObserverReady = async () => { await Promise.all(pending); };
		const connect = AudioNode.prototype.connect;
		const prepare = context => {
			if (!modules.has(context)) modules.set(context, context.audioWorklet.addModule(path));
			return modules.get(context);
		};
		globalThis.__prepareLiveOutputObservation = prepare;
		globalThis.__observeLiveOutput = (node, receive) => {
			const observer = new AudioWorkletNode(node.context, 'test-live-output-observer');
			observer.port.onmessage = ({ data }) => { receive(data); };
			Reflect.apply(connect, node, [observer]);
			Reflect.apply(connect, observer, [node.context.destination]);
			observers.push(observer);
			let stopped = false;
			return () => {
				if (stopped) return;
				stopped = true;
				observer.port.onmessage = null;
				observer.port.close();
				observer.disconnect();
				// The production envelope may already have disconnected on stop.
				try { node.disconnect(observer); } catch { /* Already disconnected. */ }
			};
		};
		AudioNode.prototype.connect = function (destination, ...ports) {
			const result = Reflect.apply(connect, this, [destination, ...ports]);
			if (destination === this.context.destination && this.context instanceof AudioContext) {
				const context = this.context;
				const ready = prepare(context).then(() => {
					if (!observeMaster) return undefined;
					const observer = new AudioWorkletNode(context, 'test-live-output-observer');
					observer.port.onmessage = ({ data }) => { samples.push(data); };
					Reflect.apply(connect, this, [observer]);
					// The observer emits silence; the production output stays connected.
					Reflect.apply(connect, observer, [context.destination]);
					// Keep its message port alive for the lifetime of the page.
					return observer;
				});
				pending.push(ready);
				void ready.catch(() => undefined);
			}
			return result;
		};
	}, { body, routedPath, property, observeMaster });
}

export async function waitForLiveOutputObserver(page) {
	await page.evaluate(() => globalThis.__liveOutputObserverReady());
}
