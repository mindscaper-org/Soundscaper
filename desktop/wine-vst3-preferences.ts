/* SPDX-License-Identifier: AGPL-3.0-only */
import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { discoverExternalWine, type ExternalWineInstallation } from './external-wine.ts';
import { authenticateYabridgePayload } from './yabridge-payload.ts';

export interface WineVst3PreferenceView {
	readonly supported: boolean; readonly enabled: boolean; readonly bridgeAvailable: boolean;
	readonly state: ExternalWineInstallation['state']; readonly location: string | null; readonly version: string | null;
}

export interface WineVst3RuntimeConfiguration {
	readonly wine: Readonly<ExternalWineInstallation>;
	readonly manifest: unknown;
	readonly runtimeRoot: string;
}

export const WINE_VST3_ACTIONS = Object.freeze([
	'enable-wine-vst3', 'disable-wine-vst3', 'browse-wine', 'clear-wine', 'rescan-wine',
]);

interface WineVst3PreferenceOptions {
	target: string; userDataPath: string; applicationRoot: string; packaged: boolean; resourcesPath?: string;
	persist: (path: string, contents: string) => Promise<void>;
	chooseExecutable: () => Promise<string | null>;
	probe?: (selectedPath: string | null) => Promise<Readonly<ExternalWineInstallation>>;
	readPayload?: () => Promise<Readonly<{ manifest: unknown; runtimeRoot: string }>>;
}

/** One persisted manual choice and a separate opt-in. Automatic results are never persisted as manual. */
export class WineVst3Preferences {
	readonly supported: boolean;
	readonly #options: Readonly<WineVst3PreferenceOptions>;
	readonly #path: string;
	#enabled = false;
	#selectedPath: string | null = null;
	#wine: Readonly<ExternalWineInstallation> = Object.freeze({ state: 'unavailable', location: null, version: null, sha256: null });
	#payload: Readonly<{ manifest: unknown; runtimeRoot: string }> | null = null;
	#ready: Promise<void> | null = null;
	#tail: Promise<void> = Promise.resolve();

	constructor(options: Readonly<WineVst3PreferenceOptions>) {
		this.#options = options;
		this.supported = options.target === 'linux-x64';
		this.#path = join(options.userDataPath, 'wine-vst3-preferences-v1.json');
		if (!this.supported) return;
		try {
			const state = JSON.parse(readFileSync(this.#path, 'utf8')) as { enabled?: unknown; selectedPath?: unknown };
			this.#enabled = state.enabled === true;
			if (typeof state.selectedPath === 'string' && state.selectedPath.startsWith('/')
				&& !state.selectedPath.includes('\0') && state.selectedPath.length <= 4096) this.#selectedPath = state.selectedPath;
		} catch { /* Missing or malformed preferences leave compatibility opt-in disabled. */ }
	}

	get enabled(): boolean { return this.supported && this.#enabled; }
	ready(): Promise<void> {
		this.#ready ??= this.supported ? this.#refresh() : Promise.resolve();
		return this.#ready;
	}
	async describe(): Promise<Readonly<WineVst3PreferenceView>> {
		await this.ready();
		return Object.freeze({ supported: this.supported, enabled: this.enabled, bridgeAvailable: this.#payload !== null,
			state: this.supported ? this.#wine.state : 'unsupported-target', location: this.#wine.location, version: this.#wine.version });
	}
	async runtimeConfiguration(): Promise<Readonly<WineVst3RuntimeConfiguration> | null> {
		await this.ready();
		return this.enabled && this.#wine.state === 'ready' && this.#payload
			? Object.freeze({ wine: this.#wine, ...this.#payload }) : null;
	}
	async helperConfiguration(): Promise<Readonly<{ configurationPath: string }> | null> {
		await this.ready();
		return this.supported ? Object.freeze({ configurationPath: join(this.#options.userDataPath, 'wine-vst3-runtime-v1.json') }) : null;
	}
	action(action: string): Promise<void> {
		if (!this.supported || !WINE_VST3_ACTIONS.includes(action)) return Promise.reject(new Error('Wine VST3 requires Linux x64.'));
		const perform = async () => {
			await this.ready();
			let selectedPath = this.#selectedPath;
			let enabled = this.#enabled;
			if (action === 'enable-wine-vst3') enabled = true;
			if (action === 'disable-wine-vst3') enabled = false;
			if (action === 'browse-wine') {
				selectedPath = await this.#options.chooseExecutable();
				if (selectedPath === null) return;
				if (!selectedPath.startsWith('/') || selectedPath.includes('\0') || selectedPath.length > 4096) {
					throw new TypeError('A selected Wine executable must have an absolute, NUL-free path.');
				}
			}
			if (action === 'clear-wine') selectedPath = null;
			if (action !== 'rescan-wine') {
				await this.#options.persist(this.#path, JSON.stringify({ enabled, selectedPath }));
				this.#enabled = enabled; this.#selectedPath = selectedPath;
			}
			if (['browse-wine', 'clear-wine', 'rescan-wine'].includes(action)) await this.#refresh();
			else await this.#writeRuntimeCache();
		};
		const pending = this.#tail.then(perform, perform);
		this.#tail = pending.catch(() => undefined);
		return pending;
	}
	async #refresh(): Promise<void> {
		this.#wine = await (this.#options.probe?.(this.#selectedPath)
			?? discoverExternalWine({ selectedPath: this.#selectedPath }));
		this.#payload = null;
		try {
			const payload = this.#options.readPayload ? await this.#options.readPayload() : await this.#readPayload();
			await authenticateYabridgePayload(payload.manifest, payload.runtimeRoot);
			this.#payload = payload;
		} catch { /* Missing or changed bridge files are unavailable, never silently replaced. */ }
		await this.#writeRuntimeCache().catch(() => { this.#payload = null; });
	}
	async #writeRuntimeCache(): Promise<void> {
		const configuration = this.enabled && this.#wine.state === 'ready' && this.#payload
			? { wine: this.#wine, ...this.#payload } : null;
		await this.#options.persist(join(this.#options.userDataPath, 'wine-vst3-runtime-v1.json'), JSON.stringify(configuration));
	}
	async #readPayload() {
		const root = this.#options.applicationRoot;
		const runtimeRoot = this.#options.packaged ? join(this.#options.resourcesPath ?? '', 'runtime')
			: join(root, '.native-build/yabridge/runtime');
		const manifestPath = this.#options.packaged ? join(root, 'config/yabridge-native-payload.json')
			: join(root, '.native-build/yabridge/manifest.json');
		return Object.freeze({ manifest: JSON.parse(await readFile(manifestPath, 'utf8')) as unknown, runtimeRoot });
	}
}
