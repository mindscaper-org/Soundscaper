/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import { setImmediate } from 'node:timers/promises';
import { test } from 'node:test';
import { rawDngFixtureV1 } from './helpers/lightscaper-raw-dng-current-fixture.ts';
import { rawRecoveryDngFixtureV1 } from './helpers/lightscaper-raw-recovery-dng-current-fixture.ts';
import { nativeRawNeutralOracleCurrentV1, nativeRawRecoveryOracleCurrentV1 } from './helpers/lightscaper-native-raw-engine-fixture-current.ts';
import { nativeRawRoleFixtureCurrentV1 as fixture, rawRoleHashCurrentV1 as hash } from './helpers/lightscaper-native-raw-role-fixture-current.ts';

function dng(): Uint8Array<ArrayBuffer> { const value = rawDngFixtureV1(); value.sensor.fill(0); return value.bytes; }
function recovery(): Uint8Array<ArrayBuffer> { const value = rawRecoveryDngFixtureV1(); value.sensor.fill(0); return value.bytes; }
function padded(): Uint8Array<ArrayBuffer> { const bytes = dng(), result = new Uint8Array(1024 * 1024 + bytes.byteLength); result.set(bytes); bytes.fill(0); return result; }
async function exact(work: Promise<unknown>, expected: unknown): Promise<void> {
 await work.then(() => { assert.fail('The actual owned operation must reject.'); }, (reason: unknown) => { assert.equal(reason, expected); });
}

void test('Lightscaper native RAW role authenticates actual file chunks, returns independent neutral words after real child exit, then wipes', { timeout: 15_000 }, async context => {
 await fixture(context, dng(), async f => {
  const input = dng(), held: { bytes?: Uint8Array } = {}, owner = f.create();
  let expected: Awaited<ReturnType<typeof nativeRawNeutralOracleCurrentV1>> | undefined, bytes = new Uint8Array();
  try {
   expected = await nativeRawNeutralOracleCurrentV1(input); bytes = new Uint8Array(expected.frame.pixels.byteLength);
   const view = new DataView(bytes.buffer); for (let index = 0; index < expected.frame.pixels.length; index++) view.setUint16(index * 2, expected.frame.pixels[index]!, true);
   await f.track(owner.withDecoded(f.request(), output => {
    assert.equal(f.activeChildren(), 0, 'Actual child and stdio must retire before pixels escape to a consumer.');
    assert.equal(output.engine, 'lightscaper-libraw-native'); assert.equal(output.engineVersion, 1); assert.equal(output.upstream, '0.22.2');
    assert.equal(output.mode, 'neutral'); assert.equal(output.tier, null); assert.equal(output.recipe, null); assert.equal(output.format, 'rgba16le');
    assert.equal(output.width, 32); assert.equal(output.height, 32); assert.equal(output.byteLength, 32 * 32 * 8);
    assert.equal(hash(output.bytes), hash(bytes)); assert.equal(output.contentSha256, hash(output.bytes)); held.bytes = output.bytes;
   }));
   assert.ok(held.bytes); assert.ok(held.bytes.every(byte => byte === 0)); assert.equal(f.state.starts, 1); assert.equal(f.state.alerts, 0);
  } finally { input.fill(0); bytes.fill(0); expected?.frame.pixels.fill(0); }
 });
});

for (const profile of ['linear-headroom-v1', 'highlight-recovery-v1'] as const) {
 void test(`Lightscaper native RAW role preserves actual ${profile} Float32 output and independent WASM numerical oracle`, { timeout: 15_000 }, async context => {
  await fixture(context, recovery(), async f => {
   const input = recovery(), owner = f.create(); let expected: Awaited<ReturnType<typeof nativeRawRecoveryOracleCurrentV1>> | undefined;
   try {
    const reference = await nativeRawRecoveryOracleCurrentV1(input, profile); expected = reference;
    await f.track(owner.withDecoded(f.request(profile === 'linear-headroom-v1' ? 'linear-headroom' : 'highlight-recovery'), output => {
     assert.equal(output.format, 'rgba32fle'); assert.equal(output.width, reference.frame.descriptor.width); assert.equal(output.height, reference.frame.descriptor.height);
     assert.equal(output.rawFlip, reference.rawFlip); assert.ok(Math.abs(output.exposureScale - reference.exposureScale) <= 1e-12);
     const bytes = new DataView(output.bytes.buffer, output.bytes.byteOffset, output.bytes.byteLength); let maximum = 0;
     assert.equal(output.bytes.byteLength, reference.frame.pixels.byteLength);
     for (let index = 0; index < reference.frame.pixels.length; index++) maximum = Math.max(maximum, Math.abs(bytes.getFloat32(index * 4, true) - reference.frame.pixels[index]!));
     assert.ok(maximum <= 2e-6, `Native role Float32 maximum difference ${maximum}.`); assert.equal(output.contentSha256, hash(output.bytes)); assert.equal(f.activeChildren(), 0);
    }));
   } finally { input.fill(0); expected?.frame.pixels.fill(0); }
  });
 });
}

void test('Lightscaper native RAW role produces fixed preview tiers and a genuine absent embedded result without inventing JPEG pixels', { timeout: 15_000 }, async context => {
 await fixture(context, dng(), async f => {
  const owner = f.create();
  for (const tier of ['thumbnail', 'fit-screen'] as const) await f.track(owner.withDecoded(f.request('neutral', tier), output => {
   assert.equal(output.format, 'rgba8'); assert.equal(output.recipe, 'lightscaper.native-original-preview.rgba8-nearest/v1');
   assert.equal(output.width, 32); assert.equal(output.height, 32); assert.equal(output.bytes.byteLength, 4096); assert.equal(output.contentSha256, hash(output.bytes));
   for (let index = 3; index < output.bytes.length; index += 4) assert.equal(output.bytes[index], 255);
  }));
  await f.track(owner.withDecoded(f.request('embedded'), output => {
   assert.equal(output.format, 'none'); assert.equal(output.byteLength, 0); assert.equal(output.width, 0); assert.equal(output.height, 0);
   assert.equal(output.channels, 0); assert.equal(output.bits, 0); assert.equal(output.contentSha256, hash(new Uint8Array()));
  }));
 });
});

void test('Lightscaper native RAW role refuses actual source SHA mismatch and joins its process before healthy retry', { timeout: 15_000 }, async context => {
 await fixture(context, dng(), async f => {
  const owner = f.create(); let consumed = 0;
  await assert.rejects(f.track(owner.withDecoded({ mode: 'neutral', tier: null, source: f.source({ sha256: '0'.repeat(64) }) }, () => { consumed++; })));
  assert.equal(consumed, 0); assert.equal(f.activeChildren(), 0); assert.equal(f.state.alerts, 0); await owner.close();
  const next = f.create(); await f.track(next.withDecoded(f.request(), output => { assert.equal(output.width, 32); }));
 });
});

void test('Lightscaper native RAW role refuses a declared length beyond the actual file without output or abandoned read', { timeout: 15_000 }, async context => {
 const bytes = dng(), length = bytes.byteLength;
 await fixture(context, bytes, async f => {
  const owner = f.create(); let consumed = 0;
  await assert.rejects(f.track(owner.withDecoded({ mode: 'neutral', tier: null, source: f.source({ byteLength: length + 1 }) }, () => { consumed++; })));
  assert.equal(consumed, 0); assert.equal(f.activeChildren(), 0); assert.equal(f.state.alerts, 0);
 });
});

void test('Lightscaper native RAW role books one global job across real owners before second borrowed input reflection', { timeout: 15_000 }, async context => {
 await fixture(context, dng(), async f => {
  const entered = f.gate(), release = f.gate(), first = f.create(), second = f.create();
  f.state.onRead = async index => { if (index === 1) { entered.release(); await release.promise; } };
  const work = f.track(first.withDecoded(f.request(), () => undefined));
  try {
   await f.reached(entered.promise); let reflected = 0;
   const poison = new Proxy({}, { ownKeys() { reflected++; throw new Error('Busy RAW request must remain unread.'); } });
   await assert.rejects(f.track(second.withDecoded(poison, () => undefined))); assert.equal(reflected, 0); assert.equal(f.state.starts, 1);
  } finally { release.release(); }
  await work; await f.track(second.withDecoded(f.request(), () => undefined)); assert.equal(f.state.starts, 2);
 });
});

void test('Lightscaper native RAW role captures a genuine prototype source reader and its receiver before asynchronous reads', { timeout: 15_000 }, async context => {
 await fixture(context, padded(), async f => {
  const source = f.source(), read: unknown = Reflect.get(source, 'read'); assert.equal(typeof read, 'function');
  const prototype = { read }; assert.ok(Reflect.deleteProperty(source, 'read')); Object.setPrototypeOf(source, prototype);
  const entered = f.gate(), release = f.gate(), owner = f.create();
  f.state.onRead = async index => { if (index === 1) { entered.release(); await release.promise; } };
  const work = f.track(owner.withDecoded({ mode: 'neutral', tier: null, source }, output => { assert.equal(output.width, 32); }));
  try { await f.reached(entered.promise); prototype.read = () => { throw new Error('Late prototype reader must not retarget accepted input.'); }; }
  finally { release.release(); }
  await work; assert.equal(f.state.reads, 2); assert.equal(f.activeChildren(), 0);
 });
});

void test('Lightscaper native RAW role opaque abort joins a held actual FileHandle receipt before retirement', { timeout: 15_000 }, async context => {
 await fixture(context, dng(), async f => {
  const owner = f.create(), caller = new AbortController(), entered = f.gate(), release = f.gate();
  f.state.onRead = async () => { entered.release(); await release.promise; };
  const reason = Symbol('actual native RAW source cancellation'); let settled = false;
  const work = f.track(owner.withDecoded(f.request(), () => assert.fail('Cancelled source must publish no pixels.'), { signal: caller.signal }));
  void work.then(() => { settled = true; }, () => { settled = true; });
  try {
   await f.reached(entered.promise); caller.abort(reason); const close = owner.close(); await setImmediate(); assert.equal(settled, false);
   release.release(); await exact(work, reason); await close; assert.equal(f.activeChildren(), 0); assert.equal(f.state.alerts, 0);
  } finally { release.release(); }
 });
});

void test('Lightscaper native RAW role close retains an actual consumer plane until its callback returns', { timeout: 15_000 }, async context => {
 await fixture(context, dng(), async f => {
  const owner = f.create(), entered = f.gate(), release = f.gate(), held: { bytes?: Uint8Array; digest?: string } = {};
  const work = f.track(owner.withDecoded(f.request(), async output => { held.bytes = output.bytes; held.digest = hash(output.bytes); entered.release(); await release.promise; }));
  try {
   await f.reached(entered.promise); assert.ok(held.bytes); let closed = false;
   const close = owner.close(); void close.then(() => { closed = true; }, () => { closed = true; }); await setImmediate();
   assert.equal(closed, false); assert.equal(hash(held.bytes), held.digest); assert.equal(f.activeChildren(), 0);
   release.release(); await work.then(() => undefined, () => undefined); await close;
   assert.ok(held.bytes.every(byte => byte === 0)); assert.equal(f.state.alerts, 0);
  } finally { release.release(); }
 });
});

void test('Lightscaper native RAW role preserves opaque callback failure without inspecting its then getter', { timeout: 15_000 }, async context => {
 await fixture(context, dng(), async f => {
  const owner = f.create(), reason = Object.freeze(Object.defineProperty({}, 'then', { get() { assert.fail('Opaque callback failure must not be assimilated.'); } }));
  const held: { bytes?: Uint8Array } = {};
  await exact(f.track(owner.withDecoded(f.request(), output => { held.bytes = output.bytes; throw reason; })), reason);
  assert.ok(held.bytes); assert.ok(held.bytes.every(byte => byte === 0)); assert.equal(f.activeChildren(), 0); assert.equal(f.state.alerts, 0);
  await f.track(owner.withDecoded(f.request(), () => undefined));
 });
});

void test('Lightscaper native RAW role actual child crash still joins a held source and releases capacity only after completion', { timeout: 15_000 }, async context => {
 await fixture(context, dng(), async f => {
  const owner = f.create(), entered = f.gate(), release = f.gate(); let settled = false;
  f.state.onRead = async index => { if (index === 1) { entered.release(); await release.promise; } };
  const work = f.track(owner.withDecoded(f.request(), () => assert.fail('Crashed actual process must return no pixels.')));
  void work.then(() => { settled = true; }, () => { settled = true; });
  try { await f.reached(entered.promise); f.kill(); await setImmediate(); assert.equal(settled, false); }
  finally { release.release(); }
  await assert.rejects(work); await owner.close(); assert.equal(f.activeChildren(), 0); assert.equal(f.state.alerts, 0);
  const next = f.create(); await f.track(next.withDecoded(f.request(), () => undefined));
 });
});

void test('Lightscaper native RAW role failed trusted start preserves opaque reason and does not strand global admission', { timeout: 15_000 }, async context => {
 await fixture(context, dng(), async f => {
  const reason = Symbol('actual start refusal'), owner = f.create({ start: () => { throw reason; } });
  await exact(f.track(owner.withDecoded(f.request(), () => assert.fail('Failed start has no output.'))), reason);
  assert.equal(f.state.starts, 0); assert.equal(f.state.reads, 0); await owner.close();
  const next = f.create(); await f.track(next.withDecoded(f.request(), () => undefined));
 });
});

void test('Lightscaper native RAW role closed frontdoor refuses before borrowed reflection and caches actual close', { timeout: 15_000 }, async context => {
 await fixture(context, dng(), async f => {
  const owner = f.create(), closing = owner.close(); assert.equal(owner.close(), closing); await closing; let reflected = 0;
  const poison = new Proxy({}, { ownKeys() { reflected++; throw new Error('Closed RAW input must remain unread.'); } });
  await assert.rejects(f.track(owner.withDecoded(poison, () => undefined))); assert.equal(reflected, 0); assert.equal(f.state.starts, 0);
 });
});

void test('Lightscaper native RAW peer independently refuses a genuine file payload under a wrong SHA before producing output', { timeout: 15_000 }, async context => {
 await fixture(context, dng(), async f => { await f.nativeHashRefusal(); assert.equal(f.activeChildren(), 0); });
});
