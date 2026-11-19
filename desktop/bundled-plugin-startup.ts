/* SPDX-License-Identifier: AGPL-3.0-only */
import { readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { BundledPluginDefaults } from './bundled-plugin-defaults.ts';
import { verifyBundledPluginCandidates } from './bundled-plugin-verification.ts';
import { DesktopPluginScanService } from './plugin-scan-service.ts';
import { scanRootLocation } from './plugin-registration-paths.ts';
import { rootIdFor } from './plugin-consent.ts';
import type { DesktopPluginRegistry, PluginScanObservation, PluginRegistryAdmission } from './plugin-registry.ts';
import type { NativeAddonAvailability } from './native-addon-payload.ts';

type ScanOptions = ConstructorParameters<typeof DesktopPluginScanService>[0];
interface Options {
	readonly registry: DesktopPluginRegistry;
	readonly supervisor: ScanOptions['supervisor'];
	readonly quarantine: ScanOptions['quarantine'] & { settle?: () => Promise<unknown> };
	readonly describePayload: () => Promise<NativeAddonAvailability>;
	readonly isEnabled: () => boolean;
	readonly isFormatActive: (format: string) => boolean;
	readonly authenticate: Parameters<typeof verifyBundledPluginCandidates>[1];
	readonly preferencesPath: string;
	readonly writeFile: (path: string, body: string) => Promise<unknown>;
	readonly allowances: { apply(registry: DesktopPluginRegistry): unknown; capture(registry: DesktopPluginRegistry): Promise<unknown> };
}

/** App-provided binaries have a private discovery route; external folder consent is unaffected. */
export function createBundledPluginStartup(options: Options) {
	let defaults: BundledPluginDefaults | null = null;
	let service: DesktopPluginScanService | null = null;
	let pending: Promise<readonly unknown[]> | null = null;
	let disposed = false;
	let generation = 0;
	const initialize = async () => {
		const expectedGeneration = generation;
		const payload = await options.describePayload();
		if (payload.status !== 'available') return [];
		const descriptor = payload.descriptor as typeof payload.descriptor & Parameters<typeof verifyBundledPluginCandidates>[0];
		if (!descriptor?.isolation?.pluginResources) return [];
		let state: unknown;
		try { state = JSON.parse(readFileSync(options.preferencesPath, 'utf8')); }
		catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
		const verified = await verifyBundledPluginCandidates(descriptor, options.authenticate);
		if (disposed || !options.isEnabled() || generation !== expectedGeneration) return [];
		defaults = new BundledPluginDefaults(state);
		defaults.setVerified(verified);
		const roots = new Map(verified.map(plugin => {
			const root = { format: plugin.format as 'vst3' | 'clap', path: dirname(plugin.binaryPath) };
			return [rootIdFor(root.format, root.path), root] as const;
		}));
		service = new DesktopPluginScanService({ supervisor: options.supervisor, quarantine: options.quarantine,
			describePayload: options.describePayload, isEnabled: options.isEnabled,
			consent: { isGranted: format => options.isFormatActive(format) && verified.some(plugin => plugin.format === format) },
			roots: { resolve: (id, format) => { const root = roots.get(id); return root?.format === format ? scanRootLocation(root) : null; } },
		});
		const outcomes = [];
		for (const [rootId, root] of roots) if (options.isFormatActive(root.format)) {
			try { outcomes.push(await service.scanRoot({ owner: roots, rootId, format: root.format })); }
			finally { await options.quarantine.settle?.(); }
		}
		if (disposed || !options.isEnabled() || generation !== expectedGeneration) return outcomes;
		options.allowances.apply(options.registry); defaults.apply(options.registry);
		await options.allowances.capture(options.registry);
		return outcomes;
	};
	return Object.freeze({
		observe(observation: PluginScanObservation, admission: PluginRegistryAdmission) {
			if (admission.status === 'recorded') defaults?.observe(options.registry, observation, admission);
		},
		ready() {
			if (disposed || !options.isEnabled()) return Promise.resolve([]);
			pending ??= initialize();
			return pending;
		},
		async setAllowed(id: string, allowed: boolean) {
			if (defaults?.setAllowed(id, allowed)) await options.writeFile(options.preferencesPath, JSON.stringify(defaults.exportState()));
		},
		cancel() { generation++; service?.cancelAll(); pending = null; },
		dispose() { disposed = true; generation++; service?.dispose(); },
	});
}
