/* SPDX-License-Identifier: AGPL-3.0-only */
export interface VerifiedBundledPlugin {
	readonly id: string;
	readonly name: string;
	readonly format: string;
	readonly classification: string;
	readonly binaryPath: string;
	readonly byteLength: number;
	readonly sha256: string;
}
interface Observation {
	readonly name: string; readonly format: string; readonly classification: string;
	readonly binaryPath: string; readonly binaryBytes: number; readonly binarySha256: string; readonly stableId: string;
}
interface Admission { readonly status: string; readonly installationId: string }
interface State { readonly schemaVersion: 1; readonly disabled: readonly string[] }

/** Default availability is a decision about authenticated app bytes, never a trust rule based on a plug-in's name. */
export class BundledPluginDefaults {
	readonly #disabled = new Set<string>();
	readonly #installations = new Map<string, string>();
	readonly #verified = new Map<string, VerifiedBundledPlugin>();
	constructor(state?: unknown) {
		if (state === undefined) return;
		if (!state || typeof state !== 'object' || Array.isArray(state)
			|| Object.keys(state).sort().join(',') !== 'disabled,schemaVersion') throw new TypeError('Invalid bundled plug-in preferences.');
		const value = state as State;
		if (value.schemaVersion !== 1 || !Array.isArray(value.disabled) || value.disabled.length > 4096
			|| value.disabled.some(key => typeof key !== 'string' || key.length > 512 || key.includes('\0'))) throw new TypeError('Invalid bundled plug-in preferences.');
		for (const key of value.disabled) this.#disabled.add(key);
	}
	setVerified(plugins: readonly VerifiedBundledPlugin[]): void {
		this.#verified.clear();
		for (const plugin of plugins) this.#verified.set(plugin.binaryPath, Object.freeze({ ...plugin }));
	}
	observe(registry: { allow(installationId: string): void }, observation: Observation, admission: Admission): boolean {
		if (admission.status !== 'recorded') return false;
		const trusted = this.#verified.get(observation.binaryPath);
		if (!trusted || trusted.format !== observation.format || trusted.classification !== observation.classification
			|| trusted.byteLength !== observation.binaryBytes || trusted.sha256 !== observation.binarySha256
			|| trusted.classification === 'instrument' && trusted.name !== observation.name) return false;
		const key = `${trusted.id}:${observation.stableId}`;
		this.#installations.set(admission.installationId, key);
		if (this.#disabled.has(key)) return false;
		registry.allow(admission.installationId);
		return true;
	}
	setAllowed(installationId: string, allowed: boolean): boolean {
		const key = this.#installations.get(installationId);
		if (!key) return false;
		if (allowed) this.#disabled.delete(key); else this.#disabled.add(key);
		return true;
	}
	apply(registry: { allow(installationId: string): void; withdrawAllowance(installationId: string): void }): void {
		for (const [installationId, key] of this.#installations) {
			if (this.#disabled.has(key)) registry.withdrawAllowance(installationId); else registry.allow(installationId);
		}
	}
	exportState(): State { return Object.freeze({ schemaVersion: 1, disabled: Object.freeze([...this.#disabled].sort()) }); }
}
