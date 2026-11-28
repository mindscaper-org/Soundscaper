/* SPDX-License-Identifier: AGPL-3.0-only */

import { dialog, MessageChannelMain } from 'electron/main';

import { createTracktionPluginLibrary } from './project-library-runtime/desktop/tracktion-plugin-library.js';
import { openTracktionProfessionalEffect } from './project-library-runtime/desktop/tracktion-professional-effect-host.js';

/** Reuse the registry, supervised utility role and sandbox payload from desktop Soundscaper. */
export function createTracktionPluginRuntime({ registry, allowances, quarantine, bundled, settings,
	consent, service, parentWindow, settleScanFaults, isFormatActive, openPersistentPluginSession, createHostHelper }) {
	const isEnabled = () => settings.snapshot().nativePluginDiscoveryEnabled === true;
	let catalogStarted;
	const rebind = (installationId) => allowances.rebind(registry, installationId);
	return createTracktionPluginLibrary({
		registry, isEnabled, isFormatActive, rebind,
		scan: async (owner, signal) => {
			const availability = await service.availability();
			if (availability.payload.status !== 'available') throw new Error('No verified plug-in scanner is available in this build.');
			if (availability.quarantined) throw new Error('The plug-in scanner is quarantined after repeated faults.');
			signal.throwIfAborted();
			const cancel = () => service.revokeOwner(owner);
			signal.addEventListener('abort', cancel, { once: true });
			try {
				for (const { format, granted, roots } of consent.describe().formats) {
					if (!granted || !isFormatActive(format) || format === 'vamp' || format === 'fixture') continue;
					for (const { rootId, admitted } of roots) {
						signal.throwIfAborted();
						if (admitted) await service.scanRoot({ owner, format, rootId });
					}
				}
				signal.throwIfAborted();
				await settleScanFaults();
				allowances.apply(registry);
				await allowances.capture(registry);
			} finally {
				signal.removeEventListener('abort', cancel);
			}
		},
		authorize: async ({ id, name, vendor, format }, signal) => {
			const window = parentWindow();
			if (!window || window.isDestroyed()) return;
			const answer = await dialog.showMessageBox(window, {
				type: 'question', title: 'Allow plug-in', message: 'Allow this installation to process your audio?',
				detail: [name, vendor, format.toUpperCase()].filter(Boolean).join(' · '),
				buttons: ['Cancel', 'Allow plug-in'], defaultId: 0, cancelId: 0, signal,
			});
			if (answer.response !== 1 || signal.aborted || !isEnabled() || !isFormatActive(format)) return;
			registry.allow(id);
			await bundled.setAllowed(id, true);
			await allowances.capture(registry);
		},
		prepareCatalog: () => {
			catalogStarted ??= (async () => {
				await bundled.ready();
				for (const id of allowances.allowedInstallationIds()) await rebind(id);
			})();
			return catalogStarted;
		},
		open: async (installationId, sampleRate, maximumFrames) => {
			const grant = registry.hostGrantFor(installationId);
			if (!isEnabled() || !isFormatActive(grant.format)) return null;
			const { supervisor } = createHostHelper(grant);
			let delegated = false;
			let session;
			try {
				session = await openPersistentPluginSession({
					supervisor, grant, sampleRate, maximumFrames, createChannel: () => new MessageChannelMain(),
				});
				void session.closed.then(
					(result) => recordFault(quarantine, grant.binarySha256, result?.reason),
					(error) => recordFault(quarantine, grant.binarySha256, error?.cause_),
				).catch(console.error);
				const effect = await openTracktionProfessionalEffect(session);
				if (!effect) return null;
				delegated = true;
				return {
					latencyFrames: effect.latencyFrames,
					process: (input, output) => {
						if (!isEnabled() || !isFormatActive(grant.format)) return Promise.reject(new Error('The native plug-in was disabled.'));
						registry.hostGrantFor(installationId);
						return effect.process(input, output);
					},
					close: async () => {
						try { await effect.close(); }
						finally { supervisor.dispose(); }
					},
				};
			} catch (error) {
				if (!session) await recordFault(quarantine, grant.binarySha256, error?.cause_);
				throw error;
			} finally {
				if (!delegated) supervisor.dispose();
			}
		},
	});
}

const faultKinds = new Map([
	['crash', 'crash'], ['hang', 'hang'], ['heartbeat', 'hang'], ['cancellation-timeout', 'hang'],
	['malformed-answer', 'malformed-answer'], ['malformed-message', 'malformed-answer'],
	['resource-violation', 'crash'], ['oversize-state', 'oversized-answer'], ['identity-changed', 'identity-change'],
]);

async function recordFault(quarantine, digest, reason) {
	const kind = faultKinds.get(reason);
	if (kind) await quarantine.record({ digest, scope: 'host', kind });
}
