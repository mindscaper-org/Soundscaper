/* SPDX-License-Identifier: AGPL-3.0-only */
import { win32 } from 'node:path';
import { canonicalNativeChildFileIdentity } from './native-child-file-identity.ts';
import type { MotionSaveFileReplacement } from './motion-save-file-replacement.ts';
import { executeMotionscaperNativeHelper } from './motionscaper-native-invocation.ts';
import { loadMotionscaperNativeExecutable } from './motionscaper-native-payload.ts';

interface NativeReplacementPort {
	verify(): Promise<void>;
	execute(arguments_: readonly string[]): Promise<string>;
}

/** The port is main-owned; renderer file calls never receive helper paths or grants. */
export function createMotionSaveReplacementPort(port: NativeReplacementPort): MotionSaveFileReplacement {
	return async input => {
		if (!win32.isAbsolute(input.source) || !win32.isAbsolute(input.destination)
			|| win32.resolve(input.source).toLowerCase() === win32.resolve(input.destination).toLowerCase()
			|| win32.dirname(win32.resolve(input.source)).toLowerCase() !== win32.dirname(win32.resolve(input.destination)).toLowerCase()) {
			throw new Error('Motion Save replacement requires distinct files in its selected directory.');
		}
		const parent = canonicalNativeChildFileIdentity(input.parent);
		const candidate = canonicalNativeChildFileIdentity({ dev: input.candidate.dev, ino: input.candidate.ino });
		const expected = input.expected && canonicalNativeChildFileIdentity({ dev: input.expected.dev, ino: input.expected.ino });
		await port.verify();
		const receipt: unknown = JSON.parse(await port.execute(['--replace-file-v1', input.source, input.destination,
			parent.dev, parent.ino, candidate.dev, candidate.ino, expected?.dev ?? '-', expected?.ino ?? '-']));
		if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt)
			|| JSON.stringify(Object.keys(receipt).sort()) !== JSON.stringify(['helperContractVersion', 'operation', 'productId'])
			|| !('productId' in receipt) || receipt.productId !== 'motionscaper'
			|| !('helperContractVersion' in receipt) || receipt.helperContractVersion !== 1
			|| !('operation' in receipt) || receipt.operation !== 'replace-file') {
			throw new Error('Motionscaper native replacement receipt is invalid.');
		}
	};
}

export async function createMotionscaperNativeFileReplacement(resourcesRoot: string, manifest: unknown): Promise<MotionSaveFileReplacement | undefined> {
	if (process.platform !== 'win32') return undefined;
	const executable = await loadMotionscaperNativeExecutable(resourcesRoot, manifest);
	if (!executable) return undefined;
	if (executable.manifest.target !== `win-${process.arch}`) throw new Error('Motionscaper file replacement helper is not target-native.');
	return createMotionSaveReplacementPort({
		async verify() { await loadMotionscaperNativeExecutable(resourcesRoot, executable.manifest); },
		execute: arguments_ => executeMotionscaperNativeHelper(executable, arguments_, new AbortController().signal, 10_000),
	});
}
