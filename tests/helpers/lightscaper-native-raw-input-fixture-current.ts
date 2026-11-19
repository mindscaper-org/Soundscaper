/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import type { TestContext } from 'node:test';
import { LightscaperNativePhotoRawInputsCurrentV1 as Native } from '../../desktop/lightscaper-native-photo-raw-inputs-current-v1.ts';
import { LightscaperNativePhotoUploadFileCurrentV1 as Upload, consumeLightscaperNativePhotoUploadFileCurrentV1 as consume } from '../../desktop/lightscaper-native-photo-upload-file-current-v1.ts';
import { openLightscaperNativePhotoMediaDatabaseCurrentV1 as openDatabase } from '../../desktop/lightscaper-native-photo-media-files-current-v1.ts';
import { nativeRawOriginalsFixtureCurrentV1 as fixture, nativeRawOriginalsHashCurrentV1 as hash } from './lightscaper-native-raw-originals-fixture-current.ts';
import type { PhotoLibraryRawImportSourceCurrentV1 as Source } from '../../src/lightscaper/controller/photo-library-raw-import-current-v1.ts';
import type { LightscaperNativePhotoUploadReadCurrentV1 as Input } from '../../desktop/lightscaper-native-photo-upload-file-current-v1.ts';
type Actual = Parameters<Parameters<typeof fixture>[1]>[0];
const CHECK = AbortSignal.prototype.throwIfAborted;
export async function nativeRawInputFixtureCurrentV1<Value>(context: TestContext,
 run: (f: Actual & Readonly<{ input: (bytes?: Uint8Array<ArrayBuffer>) => Promise<string>; owner: ReturnType<typeof Native.create>; source: Readonly<Source>; sourceEvents: readonly string[] }>) => Promise<Value>): Promise<Value> {
 return fixture(context, async f => {
  const database = await openDatabase(f.directory), uploads = new Set<Upload>(), inputs = new Map<string, Readonly<Input>>(), events: string[] = [];
  let owner: ReturnType<typeof Native.create> | undefined, failed = false, primary: unknown, result!: Value;
  const input = async (bytes: Uint8Array<ArrayBuffer> = f.bytes): Promise<string> => {
   Reflect.apply(CHECK, f.signal, []); const upload = Upload.create(database, { expectedBytes: bytes.byteLength, expectedSha256: hash(bytes) }); uploads.add(upload);
   for (let offset = 0; offset < bytes.byteLength; offset += 1048576) { Reflect.apply(CHECK, f.signal, []); await upload.write(bytes.subarray(offset, Math.min(bytes.byteLength, offset + 1048576))); }
   const proof = await upload.finish(), id = randomBytes(32).toString('hex'); inputs.set(id, consume(proof, database)); return id;
  };
  try {
   owner = Native.create({ prepare: f.prepare, scope: { signal: f.signal, assertCurrent() { Reflect.apply(CHECK, f.signal, []); f.scopes.describe(f.selected.scope); } },
    unretired: () => { f.state.alerts++; }, withInput: async (id, accept, options) => {
     const actual = inputs.get(id); if (!actual) throw new TypeError('Actual completed input handle is missing.'); inputs.delete(id); events.push('entered');
     let failed = false, primary: unknown, result: unknown;
     try { Reflect.apply(CHECK, options!.signal!, []); result = await accept(actual); } catch (error) { failed = true; primary = error; }
     try { await actual.close(); events.push('retired'); } catch (cleanup) { throw new AggregateError([...(failed ? [primary] : []), cleanup], 'Actual upload input and retirement failed.', { cause: cleanup }); }
     if (failed) throw primary; return result;
    } });
   const actualOwner = owner;
   const source: Readonly<Source> = Object.freeze<Source>({ withFrame: async (request, accept, options) => {
    const bytes = new Uint8Array(await Blob.prototype.arrayBuffer.call(request.body));
    try { assert.equal(hash(bytes), request.contentSha256); const id = await input(bytes); return await actualOwner.withFrame(id, accept, options); }
    finally { bytes.fill(0); }
   } });
   result = await run({ ...f, input, owner: actualOwner, source, sourceEvents: events });
  } catch (error) { failed = true; primary = error; }
  {
   const errors: unknown[] = []; try { await owner?.close(); } catch (error) { errors.push(error); }
   for (const upload of uploads) try { await upload.close(); } catch (error) { errors.push(error); }
   try { database.close(); } catch (error) { errors.push(error); }
   if (errors.length) throw new AggregateError([...(failed ? [primary] : []), ...errors], 'Actual RAW input peers/files did not retire.', { cause: errors[0] });
  }
  if (failed) throw primary; return result;
 });
}
