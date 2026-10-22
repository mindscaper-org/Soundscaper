/* SPDX-License-Identifier: AGPL-3.0-only */
import { ChildProcess, spawn, type ChildProcessWithoutNullStreams, type SpawnOptions } from 'node:child_process';
import type { Readable } from 'node:stream';
const KILL = ChildProcess.prototype.kill;
const QUARANTINE = new Set<object>();
export type NativeRawStdioChildCurrentV1 = Readonly<{ child: ChildProcessWithoutNullStreams; joined: Promise<void>; close(): Promise<void> }>;
/** Neutral actual-child/stdio owner. It never consumes the role's binary stdout
 * or stderr. Only trusted Main preparation supplies command/stdio artifacts. */
export function spawnNativeRawStdioChildCurrentV1(command: string, arguments_: readonly string[], options: SpawnOptions, requestStop?: (child: ChildProcessWithoutNullStreams) => void): NativeRawStdioChildCurrentV1 {
 const child = spawn(command, [...arguments_], options);
 if (!child.stdin || !child.stdout || !child.stderr) { child.on('error', () => undefined); Reflect.apply(KILL, child, ['SIGKILL']); QUARANTINE.add(child); throw new Error('Native prepared child requires actual piped stdio.'); }
 const actual = child as ChildProcessWithoutNullStreams, streamErrors: unknown[] = [];
 const streams = [actual.stdin, actual.stdout, actual.stderr, ...actual.stdio.slice(3).filter((value): value is Readable => value !== null && typeof value === 'object' && 'once' in value)]
  .map(stream => stream.closed ? Promise.resolve() : new Promise<void>(resolve => { stream.once('close', resolve); stream.on('error', () => undefined); }));
 const closed = new Promise<void>(resolve => { actual.once('close', () => { resolve(); }); });
 // Every prepared POSIX peer gets its own process group. A forcibly lost M5
 // supervisor cannot leave its one permitted parser alive outside that group.
 const terminateGroup = (): void => {
  if (process.platform !== 'win32' && options.detached === true && Number.isSafeInteger(actual.pid)) {
   try { process.kill(-actual.pid!, 'SIGKILL'); } catch (error) { if (!(error instanceof Error && 'code' in error && error.code === 'ESRCH')) streamErrors.push(error); }
  }
 };
 actual.once('exit', terminateGroup); actual.on('error', () => undefined);
 const joined = closed.then(async () => { await Promise.all(streams); if (streamErrors.length) throw new AggregateError(streamErrors, 'Native child process-group retirement failed.'); });
 void joined.catch(() => { QUARANTINE.add(owner); }); let closing: Promise<void> | undefined;
 const owner: NativeRawStdioChildCurrentV1 = Object.freeze({ child: actual, joined, close(): Promise<void> {
  if (closing) return closing; let accept!: () => void, reject!: (error: unknown) => void;
  closing = new Promise<void>((yes, no) => { accept = yes; reject = no; });
  if (actual.exitCode === null && actual.signalCode === null) { try { if (requestStop) requestStop(actual); else Reflect.apply(KILL, actual, ['SIGTERM']); } catch (error) { streamErrors.push(error); terminateGroup(); } }
  // Windows RAW uses the private supervisor control pipe. Its actual wait and
  // bounded native wall monitor retire the parser; never TerminateProcess the
  // supervisor as a substitute for that join.
  const timer = requestStop ? undefined : setTimeout(() => { terminateGroup(); if (actual.exitCode === null && actual.signalCode === null) Reflect.apply(KILL, actual, ['SIGKILL']); }, 500); timer?.unref();
  void joined.then(() => { if (timer) clearTimeout(timer); accept(); }, error => { if (timer) clearTimeout(timer); QUARANTINE.add(owner); reject(error); }); return closing;
 } }); return owner;
}
