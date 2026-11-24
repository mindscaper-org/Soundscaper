/* SPDX-License-Identifier: AGPL-3.0-only */

import type { TracktionEffectInstallation } from '../src/soundscaper/tracktion-effect-contract.ts';
import { installationIdFor } from './plugin-bundle-identity.ts';
import { PluginRegistryError, type DesktopPluginRegistry, type PluginInstallationView } from './plugin-registry.ts';
import type { TracktionOfflineEffectHost, TracktionOfflineEffectIdentity, TracktionOfflineEffectInstance } from './tracktion-offline-effects.ts';

export interface TracktionPluginLibrary extends TracktionOfflineEffectHost {
	catalog(): Promise<readonly TracktionEffectInstallation[]>;
	scan(owner: object, signal: AbortSignal): Promise<readonly TracktionEffectInstallation[]>;
	select(installationId: string, signal: AbortSignal): Promise<TracktionOfflineEffectIdentity | null>;
}

/** The current registry grant is required both when attaching and when rendering an effect. */
export function createTracktionPluginLibrary(options: Readonly<{
	registry: DesktopPluginRegistry;
	prepareCatalog: () => Promise<unknown>;
	rebind: (installationId: string) => Promise<boolean>;
	scan: (owner: object, signal: AbortSignal) => Promise<unknown>;
	authorize: (choice: TracktionEffectInstallation, signal: AbortSignal) => Promise<unknown>;
	isEnabled: () => boolean;
	isFormatActive: (format: string) => boolean;
	open: (installationId: string, rate: number, frames: number) => Promise<TracktionOfflineEffectInstance | null>;
}>): TracktionPluginLibrary {
	const { registry, isEnabled, isFormatActive } = options;
	function identityFor(installationId: string): TracktionOfflineEffectIdentity | null {
		if (!isEnabled()) return null;
		try {
			const grant = registry.hostGrantFor(installationId);
			if (grant.format === 'fixture' || !isFormatActive(grant.format)) return null;
			const entry = registry.describe().entries.find(({ installations }) => installations.some((entry) => entry.installationId === installationId));
			const installation = entry?.installations.find((entry) => entry.installationId === installationId);
			if (entry?.classification !== 'effect' || !isStereoOfflineEffect(installation)) return null;
			return { format: grant.format, stableId: grant.stableId, sha256: grant.binarySha256 };
		} catch (error) {
			if (error instanceof PluginRegistryError) return null;
			throw error;
		}
	}

	function choices(): readonly TracktionEffectInstallation[] {
		if (!isEnabled()) return [];
		return registry.describe().entries.flatMap(({ eligible, ineligibleReason, name, vendor, format, classification, installations }) => {
			const chosen = installations.find(({ selected }) => selected);
			return (eligible || ineligibleReason === 'allowance-required') && classification === 'effect'
				&& format !== 'fixture' && isFormatActive(format) && isStereoOfflineEffect(chosen)
				? [{ id: chosen.installationId, name, vendor, format, allowed: eligible }] : [];
		}).sort((left, right) => left.name.localeCompare(right.name) || left.id.localeCompare(right.id));
	}

	return Object.freeze<TracktionPluginLibrary>({
		async catalog() {
			if (!isEnabled()) return [];
			await options.prepareCatalog();
			return choices();
		},
		async scan(owner, signal) {
			if (!isEnabled()) return [];
			await options.scan(owner, signal);
			return choices();
		},
		async select(installationId, signal) {
			const choice = choices().find(({ id }) => id === installationId);
			if (!choice) throw new Error('The selected stereo effect is unavailable.');
			if (!await options.rebind(installationId)) throw new Error('The selected plug-in installation could not be verified.');
			signal.throwIfAborted();
			if (!choice.allowed) await options.authorize(choice, signal);
			signal.throwIfAborted();
			return identityFor(installationId);
		},
		async openStereo(identity, rate, frames) {
			if (!isEnabled()) return null;
			const installationId = installationIdFor(identity.sha256, identity.stableId);
			if (!await options.rebind(installationId)) return null;
			const current = identityFor(installationId);
			if (!current || current.format !== identity.format || current.stableId !== identity.stableId || current.sha256 !== identity.sha256) return null;
			return await options.open(installationId, rate, frames);
		},
	});
}

function isStereoOfflineEffect(installation: PluginInstallationView | undefined): installation is PluginInstallationView {
	return installation?.offlineSupported === true
		&& installation.topologies.some(({ inputChannels, outputChannels }) => inputChannels === 2 && outputChannels === 2);
}
