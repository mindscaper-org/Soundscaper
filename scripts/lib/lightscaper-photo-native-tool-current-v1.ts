/* SPDX-License-Identifier: AGPL-3.0-only */
import { spawn } from 'node:child_process';
const CHECK = AbortSignal.prototype.throwIfAborted;
export async function runPhotoNativeToolCurrentV1(command: string, arguments_: readonly string[], signal?: AbortSignal): Promise<string> {
 if (signal) Reflect.apply(CHECK, signal, []);
 const child = spawn(command, [...arguments_], { stdio: ['pipe', 'pipe', 'pipe'], shell: false, windowsHide: true });
 const output: Buffer[] = [], errors: Buffer[] = []; let bytes = 0, diagnostic = 0, failed = false, primary: unknown;
 const streams = [child.stdin, child.stdout, child.stderr].map(stream => new Promise<void>(resolve => { stream.once('close', resolve); stream.on('error', () => undefined); }));
 const closed = new Promise<Readonly<{ code: number | null; signal: NodeJS.Signals | null }>>(resolve => { child.once('close', (code, signal) => { resolve({ code, signal }); }); });
 // Cancellation fences later build steps and joins the accepted trusted tool.
 // Never kill CMake alone and orphan its compiler children; the outer actual
 // build-job owner supplies process-tree termination if forced retirement is needed.
 const refuse = (reason: unknown): void => { if (!failed) { failed = true; primary = reason; } };
 child.once('error', refuse); child.stdout.on('data', (value: Buffer) => { bytes += value.byteLength; if (bytes > 4 * 1024 * 1024) refuse(new RangeError('Photo native build stdout exceeded its bounded control capacity.')); else output.push(Buffer.from(value)); });
 child.stderr.on('data', (value: Buffer) => { diagnostic += value.byteLength; if (diagnostic > 4 * 1024 * 1024) refuse(new RangeError('Photo native build diagnostics exceeded their bound.')); else errors.push(Buffer.from(value)); });
 child.stdin.end();
 const outcome = await closed; await Promise.all(streams); if (signal) Reflect.apply(CHECK, signal, []);
  if (failed) throw primary;
  if (outcome.code !== 0 || outcome.signal !== null) {
   const stdout = Buffer.concat(output).toString('utf8'), stderr = Buffer.concat(errors).toString('utf8');
   // Keep the first real compiler failures even when later warnings drown the tail.
   const selected = (text: string): string => text.split(/\r?\n/u).filter(line => /\b(?:fatal\s+)?error(?:\s+[A-Z]+[0-9]+)?\s*:|\bCMake Error\b|(?:^|\s)(?:FAILED:|Build FAILED\.?)(?:\s|$)/iu.test(line))
    .slice(0, 16).map(line => line.slice(0, 512)).join('\n').slice(0, 4096);
   const important = [["stdout", selected(stdout)], ["stderr", selected(stderr)]].filter(([, text]) => text)
    .map(([stream, text]) => `\n${stream} compiler errors (bounded):\n${text}`).join('');
   throw new Error(`Photo native tool failed (${String(outcome.code)}, ${String(outcome.signal)})${important}\nstdout (tail):\n${stdout.slice(-8192)}\nstderr (tail):\n${stderr.slice(-8192)}`);
  }
  return Buffer.concat(output).toString('utf8');

}
