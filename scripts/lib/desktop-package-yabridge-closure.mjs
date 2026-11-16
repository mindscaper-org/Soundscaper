/* SPDX-License-Identifier: AGPL-3.0-only */
import { YABRIDGE_RUNTIME_FILES, YABRIDGE_RUNTIME_PREFIX } from '../../desktop/yabridge-payload.ts';
import { yabridgeRequired } from './yabridge-staging.mjs';

export function assertDesktopPackageYabridgeClosure({ runtime, target, requireFile, expectedByPrefix }) {
	const prefix = `runtime/${YABRIDGE_RUNTIME_PREFIX}/`;
	expectedByPrefix.set(prefix, new Set());
	/* Retained package manifests predate this component. New preparation always
	 * declares the field and its beforePack gate requires the target payload. */
	if (!Object.hasOwn(runtime, 'yabridge')) return;
	const required = yabridgeRequired(runtime.productId, target, runtime.nativeHarnessPreparation === true);
	if (!required && runtime.yabridge === null) return;
	const manifest = runtime.yabridge;
	if (!required || manifest?.schemaVersion !== 1 || manifest.target !== target || manifest.status !== 'built'
		|| manifest.runtimePrefix !== YABRIDGE_RUNTIME_PREFIX || !Array.isArray(manifest.files)
		|| YABRIDGE_RUNTIME_FILES.some((name) => !manifest.files.some((file) => file.path === name))) {
		throw new Error('The package has no valid yabridge content authority.');
	}
	for (const file of manifest.files) {
		if (typeof file.path !== 'string' || !/^[a-zA-Z0-9_.-]+$/u.test(file.path) || file.path.startsWith('.')) {
			throw new Error('The yabridge package inventory contains an unsafe path.');
		}
		requireFile(`${prefix}${file.path}`, file, 'bundled yabridge file', prefix);
	}
}
