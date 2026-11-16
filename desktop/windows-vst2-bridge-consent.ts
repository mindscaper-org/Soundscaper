/* SPDX-License-Identifier: AGPL-3.0-only */

/** Main owns bridge consent; absence, malformed state and other targets fail closed. */
export class WindowsVst2BridgeConsent {
	readonly supported: boolean;
	readonly #persist: (enabled: boolean) => Promise<void>;
	#enabled: boolean;
	#tail: Promise<void> = Promise.resolve();
	constructor(options: Readonly<{ target: string; state: unknown; persist: (enabled: boolean) => Promise<void> }>) {
		this.supported = options.target === 'win-x64';
		this.#enabled = this.supported && options.state === true;
		this.#persist = options.persist;
	}
	get enabled(): boolean { return this.#enabled; }
	describe() { return Object.freeze({ supported: this.supported, enabled: this.#enabled }); }
	setEnabled(enabled: boolean): Promise<void> {
		if (!this.supported) return Promise.reject(new Error('The x86 VST2 bridge requires Windows x64.'));
		const update = async () => { await this.#persist(enabled); this.#enabled = enabled; };
		const pending = this.#tail.then(update, update);
		this.#tail = pending.catch(() => undefined);
		return pending;
	}
}
