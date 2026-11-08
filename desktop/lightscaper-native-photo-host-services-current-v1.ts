/* SPDX-License-Identifier: AGPL-3.0-only */
import { lstat } from 'node:fs/promises';
import { join } from 'node:path';
import { types } from 'node:util';
import { LightscaperNativePhotoPayloadsCurrentV1 as Payloads } from './lightscaper-native-photo-payload-current-v1.ts';
import type { LightscaperNativePhotoLibraryServicesCurrentV1 as Services } from './lightscaper-native-photo-library-services-current-v1.ts';
type Options = Readonly<{ applicationRoot: string; resourcesPath: string; packaged: boolean; chooseLinkedRoot: NonNullable<Services['chooseLinkedRoot']> }>;
const QUARANTINE = new Set<object>();
/** Optional installed native closure. Only absence of the fixed protected app
 * manifest permits fallback; a present invalid or incomplete bundle refuses. */
export class LightscaperNativePhotoHostServicesCurrentV1 {
 readonly #options: Options;
 #opening: Promise<Readonly<Services>> | undefined; #payloads: Payloads | undefined;
 #closing: Promise<void> | undefined; #failure: unknown; #failed = false;
 constructor(options: Options) {
  const choose = options.chooseLinkedRoot;
  this.#options = Object.freeze<Options>({ applicationRoot: options.applicationRoot, resourcesPath: options.resourcesPath, packaged: options.packaged,
   chooseLinkedRoot: signal => Reflect.apply(choose, options, [signal]) as ReturnType<NonNullable<Services['chooseLinkedRoot']>> });
 }
 services(): Promise<Readonly<Services>> {
  if (this.#closing) return Promise.reject(new Error('Installed Photo native services are closing.'));
  if (this.#opening) return this.#opening;
  this.#opening = Promise.resolve().then(async () => {
   const selected = this.#options;
   try { await lstat(join(selected.applicationRoot, 'config/lightscaper-native-photo-payload-current-v1.json')); }
   catch (error) { if (types.isNativeError(error) && Object.getOwnPropertyDescriptor(error, 'code')?.value === 'ENOENT') return Object.freeze({}); throw error; }
   const payloads = await Payloads.open({ applicationRoot: selected.applicationRoot, resourcesPath: selected.resourcesPath, packaged: selected.packaged });
   this.#payloads = payloads; const prepare = payloads.prepare;
   return Object.freeze<Services>({ chooseLinkedRoot: selected.chooseLinkedRoot,
    prepareGrantedFilesystem: options => Reflect.apply(prepare, payloads, ['granted-filesystem', options]) as ReturnType<NonNullable<Services['prepareGrantedFilesystem']>>,
    prepareRaw: options => Reflect.apply(prepare, payloads, ['raw-engine', options]) as ReturnType<NonNullable<Services['prepareRaw']>> });
  }).catch((error: unknown) => {
   // This boundary calls only the captured native payload constructor. Its
   // combined opening/cleanup refusal retains the unreturned real owner.
   if (types.isNativeError(error) && Object.getOwnPropertyDescriptor(error, 'errors')) { this.#failed = true; this.#failure = error; QUARANTINE.add(this); } throw error;
  }); return this.#opening;
 }
 close(): Promise<void> {
  if (this.#closing) return this.#closing;
  this.#closing = Promise.resolve().then(async () => {
   if (this.#opening) await Promise.allSettled([this.#opening]);
   try { await this.#payloads?.close(); } catch (error) { this.#failed = true; this.#failure = error; QUARANTINE.add(this); }
   if (this.#failed) throw this.#failure;
  }); return this.#closing;
 }
}
