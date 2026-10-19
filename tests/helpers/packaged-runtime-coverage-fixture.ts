/* SPDX-License-Identifier: AGPL-3.0-only */

import { EventEmitter } from 'node:events';

import {
	INSTALL_WORKLET_COVERAGE_CHECKPOINT,
	WORKLET_COVERAGE_CHECKPOINT_URL,
} from '../../scripts/lib/browser-service-worker-coverage.mjs';

export function coverageEntry(scriptId: string, url: string, endOffset: number) {
	return {
		functions: [{
			functionName: '',
			isBlockCoverage: true,
			ranges: [{ count: 1, endOffset, startOffset: 0 }],
		}],
		scriptId,
		url,
	};
}

export class FakePage {
	readonly calls: string[] = [];
	readonly #childType: string;
	readonly #context: FakeContext | null = null;
	readonly #entries: ReturnType<typeof coverageEntry>[];
	readonly #workerEntries: ReturnType<typeof coverageEntry>[];
	readonly #url: string;
	#coverageTakes = 0;
	reloadCount = 0;

	constructor(
		url: string,
		entries: ReturnType<typeof coverageEntry>[],
		workerEntries: ReturnType<typeof coverageEntry>[] = [],
		childType = 'worker',
	) {
		this.#childType = childType;
		this.#url = url;
		this.#entries = entries;
		this.#workerEntries = workerEntries;
	}

	context(): FakeContext {
		return this.#context ?? (this as unknown as { owner: FakeContext }).owner;
	}

	isClosed(): boolean { return false; }

	async reload(): Promise<void> {
		this.calls.push('Page.reload');
		this.reloadCount += 1;
	}

	async waitForLoadState(): Promise<void> {}
	reloadReadiness: Promise<void> = Promise.resolve();
	async waitForFunction(): Promise<void> {
		await this.reloadReadiness;
		this.calls.push('product:reloadReady');
	}

	url(): string { return this.#url; }

	coverageEntries() { return this.#entries; }
	childType() { return this.#childType; }
	takeCoverageEntries() {
		this.#coverageTakes += 1;
		return this.#coverageTakes === 1 ? [] : this.#entries;
	}

	workerCoverageEntries() { return this.#workerEntries; }
}

export class FakeContext {
	readonly #browserRoot = Object.assign(new EventEmitter(), {
		createChildSession() { throw new Error('This fake creates no service workers.'); },
	});
	readonly #listeners: Array<(page: FakePage) => void> = [];
	readonly #pages: FakePage[];

	constructor(pages: FakePage[]) {
		this.#pages = pages;
		for (const page of pages) (page as unknown as { owner: FakeContext }).owner = this;
	}

	browser() {
		const implementation = Object.assign(new EventEmitter(), { _session: this.#browserRoot });
		return {
			_connection: { toImpl: () => implementation },
			async newBrowserCDPSession() {},
		};
	}

	on(event: string, listener: (page: FakePage) => void): void {
		if (event === 'page') this.#listeners.push(listener);
	}

	pages(): FakePage[] { return this.#pages; }

	async newCDPSession(page: FakePage) {
		const emitter = new EventEmitter();
		let childAttached = false;
		return Object.assign(emitter, {
			async detach() { page.calls.push('CDP.detach'); },
			async send(method: string, parameters?: { scriptId?: string }) {
				page.calls.push(method);
				if (method === 'Page.reload') {
					page.reloadCount += 1;
					queueMicrotask(() => emitter.emit('Page.loadEventFired', {}));
				}
				if (method === 'Target.setAutoAttach' && !childAttached && page.workerCoverageEntries().length) {
					childAttached = true;
					queueMicrotask(() => emitter.emit('Target.attachedToTarget', {
						sessionId: 'worker-session',
						targetInfo: {
							targetId: 'worker-target',
							type: page.childType(),
							url: page.workerCoverageEntries()[0]?.url,
						},
						waitingForDebugger: true,
					}));
				}
				if (method === 'Target.sendMessageToTarget') {
					const request = JSON.parse(String((parameters as { message?: string })?.message)) as {
						id: number;
						method: string;
						params?: { scriptId?: string };
					};
					page.calls.push(`child:${request.method}`);
					let result: unknown = {};
					if (request.method === 'Debugger.getScriptSource') {
						const entry = page.workerCoverageEntries()
							.find(({ scriptId }) => scriptId === request.params?.scriptId);
						result = entry?.url.startsWith('wasm:')
							? { bytecode: 'AGFzbQEAAAA=', scriptSource: '' }
							: {
								scriptSource: request.params?.scriptId === 'coverage-worklet-hook'
									? INSTALL_WORKLET_COVERAGE_CHECKPOINT
									: `worker-source:${String(request.params?.scriptId)}`,
							};
					} else if (request.method === 'Profiler.takePreciseCoverage') {
						result = {
							result: page.workerCoverageEntries().map((entry) => ({ ...entry, url: '' })),
						};
					} else if (request.method === 'Runtime.evaluate' && page.childType() === 'worklet') {
						result = { result: { value: true } };
					}
					queueMicrotask(() => {
						emitter.emit('Target.receivedMessageFromTarget', {
							message: JSON.stringify(request.method === 'Target.setAutoAttach' && page.childType() === 'worklet'
								? { id: request.id, error: { message: "'Target.setAutoAttach' wasn't found" } }
								: { id: request.id, result }),
							sessionId: 'worker-session',
						});
						if (request.method === 'Debugger.enable') {
							for (const entry of page.workerCoverageEntries()) {
								emitter.emit('Target.receivedMessageFromTarget', {
									message: JSON.stringify({ method: 'Debugger.scriptParsed', params: {
										scriptId: entry.scriptId,
										...(entry.url.startsWith('wasm:')
											? { scriptLanguage: 'WebAssembly' } : {}),
										url: entry.url,
									} }),
									sessionId: 'worker-session',
								});
							}
						}
						if (request.method === 'Runtime.evaluate' && page.childType() === 'worklet') {
							emitter.emit('Target.receivedMessageFromTarget', {
								message: JSON.stringify({ method: 'Debugger.scriptParsed', params: {
									scriptId: 'coverage-worklet-hook',
									url: WORKLET_COVERAGE_CHECKPOINT_URL,
								} }),
								sessionId: 'worker-session',
							});
						}
						if (request.method === 'Runtime.runIfWaitingForDebugger') {
							emitter.emit('Target.receivedMessageFromTarget', {
								message: JSON.stringify({
									method: 'Profiler.preciseCoverageDeltaUpdate',
									params: { result: page.workerCoverageEntries().map((entry) => ({ ...entry, url: '' })) },
								}),
								sessionId: 'worker-session',
							});
							if (page.childType() === 'worklet') {
								emitter.emit('Target.receivedMessageFromTarget', {
									message: JSON.stringify({ method: 'Debugger.paused', params: {
										callFrames: [{ location: { scriptId: 'coverage-worklet-hook' } }],
									} }),
									sessionId: 'worker-session',
								});
							} else {
								emitter.emit('Target.detachedFromTarget', { sessionId: 'worker-session' });
							}
						}
					});
					return {};
				}
				if (method === 'Debugger.enable') {
					for (const entry of page.coverageEntries()) {
						queueMicrotask(() => emitter.emit('Debugger.scriptParsed', {
							scriptId: entry.scriptId,
							...(entry.url.startsWith('wasm:')
								? { scriptLanguage: 'WebAssembly' } : {}),
							url: entry.url,
						}));
					}
				}
				if (method === 'Debugger.getScriptSource') {
					const entry = page.coverageEntries()
						.find(({ scriptId }) => scriptId === parameters?.scriptId);
					return entry?.url.startsWith('wasm:')
						? { bytecode: 'AGFzbQEAAAA=', scriptSource: '' }
						: { scriptSource: `source:${String(parameters?.scriptId)}` };
				}
				if (method === 'Profiler.takePreciseCoverage') {
					return { result: page.takeCoverageEntries() };
				}
				return {};
			},
		});
	}
}
