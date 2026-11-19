/* SPDX-License-Identifier: AGPL-3.0-only */
import { join } from 'node:path';
import { runPhotoNativeToolCurrentV1 as tool } from './lightscaper-photo-native-tool-current-v1.ts';
import type { PhotoNativeTargetCurrentV1 } from '../../src/lightscaper/desktop-photo-native-artifacts-current-v1.ts';
/** Seal before inventory capture. Electron packaging preserves these final nested
 * bytes; app/installer signing is independent. Windows PE helpers carry no
 * Authenticode claim and are authenticated by the protected app inventory. */
export async function sealPhotoNativeCodeCurrentV1(root: string, target: PhotoNativeTargetCurrentV1, names: readonly string[], signal?: AbortSignal): Promise<void> {
 if (target !== 'mac-arm64') return;
 const release = process.env.SCAPE_MAC_SIGNING === 'true', identity = release ? process.env.CSC_NAME : '-';
 if (!identity || (release && (!identity.startsWith('Developer ID Application: ') || !/^[A-Z0-9]{10}$/u.test(process.env.APPLE_TEAM_ID ?? '')))) throw new Error('Photo native release sealing requires the configured Developer ID and team.');
 for (const name of names) {
  const arguments_ = ['--force', '--sign', identity, ...(release ? ['--options', 'runtime', '--timestamp'] : ['--timestamp=none']), join(root, name)];
  await tool('/usr/bin/codesign', arguments_, signal);
 }
 await verifyPhotoNativeCodeCurrentV1(root, target, names, signal);
}
export async function verifyPhotoNativeCodeCurrentV1(root: string, target: PhotoNativeTargetCurrentV1, names: readonly string[], signal?: AbortSignal): Promise<void> {
 if (target !== 'mac-arm64') return;
 for (const name of names) await tool('/usr/bin/codesign', ['--verify', '--strict', '--verbose=2', ...(process.env.SCAPE_MAC_SIGNING === 'true'
  ? ['--test-requirement', `anchor apple generic and certificate leaf[subject.OU] = "${process.env.APPLE_TEAM_ID ?? ''}"`] : []), join(root, name)], signal);
}
