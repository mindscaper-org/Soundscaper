/* SPDX-License-Identifier: AGPL-3.0-only */

import { LightscaperNativePhotoLibraryScopesCurrentV1 as Scopes } from '../../desktop/lightscaper-native-photo-library-scopes-current-v1.ts';

export interface NativeLibraryScopeProbeCurrentV1 { readonly opened: boolean; readonly retired: boolean }

const directory = process.argv[2];
if (!directory || !process.send) throw new Error('Scope guard child requires actual fork IPC and appData.');
const send = process.send.bind(process);
let owner: Scopes | undefined, opened = false, retired = false;
try { owner = await Scopes.open({ appDataPath: directory }); opened = true; }
catch { /* Genuine cross-process refusal is an expected probe result. */ }
if (owner) { try { await owner.close(); retired = true; } catch { process.exitCode = 1; } }
else retired = true;
await new Promise<void>((resolve, reject) => { send({ opened, retired } satisfies NativeLibraryScopeProbeCurrentV1, error => { if (error) reject(error); else resolve(); }); });
process.disconnect?.();
