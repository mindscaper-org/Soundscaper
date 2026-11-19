/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import { AsyncLocalStorage } from 'node:async_hooks';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { TestContext } from 'node:test';
import { copyNativeTestFixture } from '../../scripts/lib/node-native-test-fixtures.ts';
import neutralPin from '../../config/lightscaper-libraw-runtime-manifest.json' with { type: 'json' };
import recoveryPin from '../../config/lightscaper-libraw-recovery-runtime-manifest.json' with { type: 'json' };
import { decodeLibRawOriginalWasmV1, readLibRawEmbeddedPreviewWasmV1 } from '../../src/common/editor/raw/libraw-wasm-instance-v1.ts';
import { decodeLibRawRecoveryWasmV2 } from '../../src/common/editor/raw/libraw-wasm-instance-v2.ts';

export type NativeRawModeCurrentV1 = 'neutral' | 'linear-headroom' | 'highlight-recovery' | 'embedded'
 | 'preview-neutral' | 'preview-headroom' | 'preview-recovery';
export interface NativeRawResultCurrentV1 {
 readonly engine: 'lightscaper-libraw-native'; readonly engineVersion: 1; readonly upstream: '0.22.2';
 readonly profile: NativeRawModeCurrentV1; readonly recipe: string | null; readonly format: string;
 readonly width: number; readonly height: number; readonly channels: number; readonly bits: number;
 readonly rawFlip: number; readonly exposureScale: number; readonly byteLength: number; readonly bytes: Uint8Array<ArrayBuffer>;
}
const ROOT = new URL('../../', import.meta.url), MAXIMUM_OUTPUT = 17 * 1024 * 1024;
type OwnedPlane = Uint8Array | Uint16Array | Float32Array;
const ownership = new AsyncLocalStorage<Set<OwnedPlane>>();
function own<Plane extends OwnedPlane>(value: Plane): Plane { ownership.getStore()?.add(value); return value; }
let neutral: Promise<WebAssembly.Module> | undefined, recovered: Promise<WebAssembly.Module> | undefined;
export function nativeRawHashCurrentV1(value: Uint8Array): string { return createHash('sha256').update(value).digest('hex'); }
async function moduleFor(pin: typeof neutralPin.runtime): Promise<WebAssembly.Module> {
 const bytes = new Uint8Array(await readFile(new URL(pin.path, ROOT)));
 assert.equal(bytes.byteLength, pin.byteLength); assert.equal(nativeRawHashCurrentV1(bytes), pin.sha256);
 return WebAssembly.compile(bytes);
}
export async function nativeRawNeutralOracleCurrentV1(bytes: Uint8Array<ArrayBuffer>) {
 own(bytes); neutral ??= moduleFor(neutralPin.runtime); const value = decodeLibRawOriginalWasmV1(await neutral, bytes); own(value.frame.pixels); return value;
}
export async function nativeRawRecoveryOracleCurrentV1(bytes: Uint8Array<ArrayBuffer>, profile: 'linear-headroom-v1' | 'highlight-recovery-v1') {
 own(bytes); recovered ??= moduleFor(recoveryPin.runtime); const value = decodeLibRawRecoveryWasmV2(await recovered, bytes, profile); own(value.frame.pixels); return value;
}
export async function nativeRawEmbeddedOracleCurrentV1(bytes: Uint8Array<ArrayBuffer>) {
 own(bytes); neutral ??= moduleFor(neutralPin.runtime); const value = readLibRawEmbeddedPreviewWasmV1(await neutral, bytes); if (value) own(value.bytes); return value;
}

/** Root prepares the one shared native fixture before Node starts. This helper
 * never compiles synchronously inside a fifteen-second resource-owning test. */
export async function nativeRawEngineFixtureCurrentV1<Value>(context: TestContext, run: (fixture: Readonly<{
 execute(mode: NativeRawModeCurrentV1, bytes: Uint8Array<ArrayBuffer>, tier?: 'thumbnail' | 'fit-screen'): Promise<NativeRawResultCurrentV1>;
 refuse(bytes: Uint8Array<ArrayBuffer>, mode?: NativeRawModeCurrentV1): Promise<void>;
}>) => Promise<Value>): Promise<Value> {
 const directory = await mkdtemp(join(tmpdir(), 'lightscaper-native-raw-engine-'));
 const owned = new Set<OwnedPlane>();
 const executable = join(directory, process.platform === 'win32' ? 'fixture.exe' : 'fixture');
 try {
  assert.ok(copyNativeTestFixture({ repositoryRoot: fileURLToPath(ROOT), kind: 'lightscaper-raw-engine', outputPath: executable }),
   'Root must prepare the real lightscaper-raw-engine fixture through the shared native fixture producer.');
  const fixture = Object.freeze({
   execute: async (mode: NativeRawModeCurrentV1, bytes: Uint8Array<ArrayBuffer>, tier?: 'thumbnail' | 'fit-screen') => {
    owned.add(bytes); const result = await invoke(context, executable, [mode, ...tier ? [tier] : []], bytes);
    assert.equal(result.code, 0, `Actual native engine refused (${result.stderr.slice(0, 512)}).`);
    try { const value = parse(result.bytes, mode); owned.add(value.bytes); return value; } finally { result.bytes.fill(0); }
   },
   refuse: async (bytes: Uint8Array<ArrayBuffer>, mode: NativeRawModeCurrentV1 = 'neutral') => {
    owned.add(bytes); const result = await invoke(context, executable, [mode], bytes); owned.add(result.bytes);
    assert.equal(result.code, 2, 'Actual engine must explicitly refuse corrupt/unsupported input.');
    assert.ok(result.stderr.length > 0 && result.stderr.length <= 513); assert.equal(result.bytes.byteLength, 0);
   },
  });
  context.signal.throwIfAborted(); return await ownership.run(owned, () => run(fixture));
 } finally { for (const value of owned) value.fill(0); await rm(directory, { recursive: true, force: true }); }
}
async function invoke(context: TestContext, executable: string, arguments_: readonly string[], bytes: Uint8Array<ArrayBuffer>) {
 context.signal.throwIfAborted(); const child = spawn(executable, [...arguments_], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
 const output: Buffer[] = [], errors: Buffer[] = []; let outputSize = 0, errorSize = 0, failure: unknown, ended = false, deadline = false;
 const kill = () => { if (!ended) child.kill('SIGKILL'); };
 const closed = new Promise<Readonly<{ code: number | null; signal: NodeJS.Signals | null }>>(resolve => {
  child.once('error', error => { failure ??= error; });
  child.once('close', (code, signal) => { ended = true; resolve({ code, signal }); });
 });
 child.stdout.on('data', (part: Buffer) => {
  outputSize += part.byteLength;
  if (outputSize > MAXIMUM_OUTPUT) { failure ??= new Error('Native fixture exceeded its test-only output budget.'); kill(); return; }
  output.push(Buffer.from(part));
 });
 child.stderr.on('data', (part: Buffer) => {
  errorSize += part.byteLength;
  if (errorSize > 16_384) { failure ??= new Error('Native fixture exceeded its stderr budget.'); kill(); return; }
  errors.push(Buffer.from(part));
 });
 child.stdin.on('error', error => { if (!failure && !('code' in error && error.code === 'EPIPE')) failure = error; });
 const timer = setTimeout(() => { deadline = true; kill(); }, 10_000);
 context.signal.addEventListener('abort', kill, { once: true });
 try {
  if (context.signal.aborted) kill(); else child.stdin.end(bytes);
  const result = await closed; context.signal.throwIfAborted();
  if (deadline) throw new Error('Actual native fixture exceeded its owned child deadline.');
  if (failure) throw failure; assert.equal(result.signal, null);
  return { code: result.code, bytes: new Uint8Array(Buffer.concat(output)), stderr: Buffer.concat(errors).toString('utf8') };
 } finally {
  clearTimeout(timer); context.signal.removeEventListener('abort', kill);
  if (!ended) kill(); await closed;
  for (const part of [...output, ...errors]) part.fill(0);
 }
}
function parse(bytes: Uint8Array<ArrayBuffer>, profile: NativeRawModeCurrentV1): NativeRawResultCurrentV1 {
 let end = 6; assert.equal(new TextDecoder().decode(bytes.subarray(0, end)), 'LRAW1\n');
 while (end < bytes.byteLength && end < 4102 && bytes[end] !== 10) end++;
 assert.ok(end < 4102 && bytes[end] === 10, 'Native result metadata must be bounded before parsing.');
 const value: unknown = JSON.parse(new TextDecoder().decode(bytes.subarray(6, end)));
 assert.ok(value && typeof value === 'object' && !Array.isArray(value));
 const keys = ['engine', 'engineVersion', 'upstream', 'profile', 'recipe', 'format', 'width', 'height', 'channels', 'bits', 'rawFlip', 'exposureScale', 'byteLength'];
 assert.deepEqual(Object.keys(value).sort(), [...keys].sort());
 const get = (key: string): unknown => Reflect.get(value, key);
 assert.equal(get('engine'), 'lightscaper-libraw-native'); assert.equal(get('engineVersion'), 1); assert.equal(get('upstream'), '0.22.2'); assert.equal(get('profile'), profile);
 const recipe = get('recipe'); assert.equal(recipe, profile.startsWith('preview-') ? 'lightscaper.native-original-preview.rgba8-nearest/v1' : null);
 const format = get('format'); assert.ok(typeof format === 'string' && ['none', 'rgba16le', 'rgba32fle', 'rgba8', 'jpeg', 'bitmap8', 'bitmap16le'].includes(format));
 const scalar = (key: string, maximum: number): number => { const input = get(key); assert.ok(typeof input === 'number' && Number.isSafeInteger(input) && input >= 0 && input <= maximum); return input; };
 const width = scalar('width', 8192), height = scalar('height', 8192), channels = scalar('channels', 4), bits = scalar('bits', 32), rawFlip = scalar('rawFlip', 7);
 const byteLength = scalar('byteLength', 256 * 1024 * 1024), exposureScale = get('exposureScale'); assert.ok(typeof exposureScale === 'number' && Number.isFinite(exposureScale));
 assert.equal(bytes.byteLength - end - 1, byteLength);
 const body = new Uint8Array(bytes.subarray(end + 1)); bytes.fill(0);
 return Object.freeze({ engine: 'lightscaper-libraw-native', engineVersion: 1, upstream: '0.22.2', profile, recipe: typeof recipe === 'string' ? recipe : null, format, width, height, channels, bits, rawFlip, exposureScale, byteLength, bytes: body });
}
