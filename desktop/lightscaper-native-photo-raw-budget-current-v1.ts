/* SPDX-License-Identifier: AGPL-3.0-only */
/** Canonical leaf: wrapped starts/query-imported owners share one native lane. */
let active: object | undefined;
const quarantined = new Set<object>();
export function reserveLightscaperNativePhotoRawCurrentV1(): Readonly<{ release(): void; quarantine(owner: object): void }> {
 if (active || quarantined.size) throw new Error('The native RAW lane is busy or quarantined.');
 const token = Object.freeze({}); active = token;
 return Object.freeze({
  release() { if (active === token && quarantined.size === 0) active = undefined; },
  quarantine(owner) { quarantined.add(owner); },
 });
}
export function quarantineLightscaperNativePhotoRawCurrentV1(owner: object): void { quarantined.add(owner); }
