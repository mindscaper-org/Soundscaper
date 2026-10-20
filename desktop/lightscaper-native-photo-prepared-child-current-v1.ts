/* SPDX-License-Identifier: AGPL-3.0-only */
import type { ChildProcessWithoutNullStreams, SpawnOptions } from 'node:child_process';
import type { Readable, Writable } from 'node:stream';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { nativeChildLauncherEnvironment } from './native-child-launcher-environment.ts';
import { waitForNativeChildEnforcement } from './native-child-enforcement-handshake.ts';
import { spawnNativeRawStdioChildCurrentV1 as spawn } from './native-child-raw-stdio-current-v1.ts';
import { openPhotoNativePinnedFileCurrentV1 as authenticate } from './lightscaper-native-photo-artifact-files-current-v1.ts';
import { photoNativePathsCurrentV1, type PhotoNativeFileCurrentV1, type PhotoNativeRoleCurrentV1, type PhotoNativeTargetCurrentV1 } from '../src/lightscaper/desktop-photo-native-artifacts-current-v1.ts';
import { checkNativeFilesystemSignal as check, linkNativeFilesystemSignal as link } from './lightscaper-native-photo-granted-filesystem-signal-current-v1.ts';
export type LightscaperNativePhotoPreparedChildCurrentV1 = Readonly<{ start(): ChildProcessWithoutNullStreams; close(): Promise<void> }>;
const QUARANTINE = new Set<object>(), UNPROVED = new WeakSet<object>();
export function photoNativePreparedRetirementIsUnprovedCurrentV1(value: unknown): boolean { return typeof value === 'object' && value !== null && UNPROVED.has(value); }
/** Main-private fixed-role preparation used by both the authenticated producer
 * self-test and protected package owner. No caller executable/argv is admitted. */
export async function preparePhotoNativeChildCurrentV1(root: string, target: PhotoNativeTargetCurrentV1, files: readonly PhotoNativeFileCurrentV1[],
 role: PhotoNativeRoleCurrentV1, signal: AbortSignal | undefined, retired: () => void): Promise<LightscaperNativePhotoPreparedChildCurrentV1> {
 const paths = photoNativePathsCurrentV1(target), pins = new Map(files.map(file => [file.path, file])), handles: Awaited<ReturnType<typeof authenticate>>[] = [];
 let peer: ReturnType<typeof spawn> | undefined, detach: () => void = () => {}, close: Promise<void> | undefined, used = false, failure: unknown;
 const owner: LightscaperNativePhotoPreparedChildCurrentV1 = Object.freeze({ start(): ChildProcessWithoutNullStreams {
  check(signal); if (used || close || !peer || peer.child.exitCode !== null || peer.child.signalCode !== null) throw new Error('Photo prepared native child is retired or already claimed.'); used = true; return peer.child;
 }, close(): Promise<void> {
  if (close) return close; let accept!: () => void, reject!: (error: unknown) => void; close = new Promise<void>((yes, no) => { accept = yes; reject = no; });
  void (async () => {
   const errors: unknown[] = [];
   try { await peer?.close(); } catch (error) { errors.push(error); }
   for (const handle of [...handles].reverse()) try { await handle.close(); } catch (error) { errors.push(error); }
   try { detach(); } catch (error) { errors.push(error); }
   if (errors.length) { const error = new AggregateError(errors, 'Photo prepared native child/artifact retirement failed.'); UNPROVED.add(error); QUARANTINE.add({ owner, peer, handles, error, failure }); throw error; }
   try { retired(); } catch (cleanup) { const error = new AggregateError([cleanup], 'Photo native capacity/link retirement is unproved.'); UNPROVED.add(error); QUARANTINE.add({ owner, peer, handles, error }); throw error; }
  })().then(accept, reject); return close;
 } });
 try {
  check(signal);
  const names = role === 'raw-engine' ? [paths.launcher, paths.profile, paths.broker, paths.raw] : [paths.filesystem];
  for (const name of names) { const pin = pins.get(name); if (!pin) throw new Error('Photo native fixed-role artifact is absent.'); handles.push(await authenticate(root, pin)); check(signal); }
  const isolated = role === 'raw-engine', stdio: SpawnOptions['stdio'] = isolated ? ['pipe', 'pipe', 'pipe', 'pipe', ...handles.map(value => value.handle.fd)] : ['pipe', 'pipe', 'pipe', handles[0]!.handle.fd];
  const args = isolated ? ['--enforcement-fd=3', '--profile-fd=5', '--broker-policy-fd=6', '--executable-fd=7', '--maximum-duration-ms=30000', '--maximum-rss-bytes=805306368'] : [];
  if (isolated && target.startsWith('win-')) { if (!Array.isArray(stdio)) throw new Error('Photo Windows stdio mapping is absent.'); stdio.push('pipe'); args.push('--control-fd=8', `--authority-profile=lightscaper-raw:${createHash('sha256').update(JSON.stringify({ target, files: names.map(name => pins.get(name)) })).digest('hex')}`); }
  if (isolated) args.push('--', 'lightscaper-photo-native-raw');
  const command = target.startsWith('linux-') ? `/proc/self/fd/${isolated ? '4' : '3'}` : join(root, isolated ? paths.launcher : paths.filesystem);
  peer = spawn(command, args, { stdio, shell: false, windowsHide: true, cwd: join(root, 'bin'), detached: process.platform !== 'win32', env: { ...nativeChildLauncherEnvironment(target), NODE_V8_COVERAGE: undefined } }, isolated && target.startsWith('win-') ? child => { const control = child.stdio.at(8); if (!control || typeof control === 'number' || !('end' in control)) throw new Error('Photo Windows supervisor control is absent.'); (control as Writable).end(Buffer.from([1])); } : undefined);
  const actual = peer;
  detach = link(signal, () => { void owner.close().catch(() => undefined); }); check(signal);
  // The role waits for its protocol INIT; no binary body output is consumed.
  if (isolated) {
   const enforcement = actual.child.stdio[3]; if (!enforcement || typeof enforcement === 'number' || !('read' in enforcement)) throw new Error('Photo RAW launcher omitted its genuine enforcement stream.');
   await waitForNativeChildEnforcement(enforcement as Readable, 5000); check(signal);
  }
  if (actual.child.exitCode !== null || actual.child.signalCode !== null) throw new Error('Photo native peer exited before start delivery.');
  void actual.joined.then(() => owner.close(), () => owner.close()).catch(() => undefined);
  return owner;
 } catch (error) {
  failure = error; let primary = error; try { check(signal); } catch (reason) { primary = reason; }
  try { await owner.close(); } catch (cleanup) { const error = new AggregateError([primary, cleanup], 'Photo native preparation and retirement failed.'); UNPROVED.add(error); throw error; } throw primary;
 }
}
