/* SPDX-License-Identifier: AGPL-3.0-only */
import type {PhotoDocumentCurrentV1} from './catalog/photo-document-current-v1.ts';
import type {CatalogOriginalRepairBindingV1} from '../common/editor/storage/media-catalog-original-repair-contract.ts';
import type {PhotoLibraryRawImportSourceCurrentV1} from './controller/photo-library-raw-import-current-v1.ts';
import type {DesktopPhotoLibrarySessionHandleCurrentV1 as Handle} from './desktop-photo-library-session-protocol-current-v1.ts';
import type {DesktopPhotoLinkedInputReceiptCurrentV1 as Input} from './desktop-photo-linked-contract-current-v1.ts';
export interface DesktopPhotoLinkedGrantCurrentV1{readonly grantId:string;readonly displayName:string;readonly revision:number;readonly revoked:boolean}
export type DesktopPhotoLinkedScanCurrentV1=Readonly<Handle<'linked-scan'>>;
export type DesktopPhotoLinkedInputCurrentV1=Readonly<Handle<'linked-input'>>;
export interface DesktopPhotoLinkedEntryCurrentV1{readonly entryId:string;readonly displayName:string;readonly kind:'file'|'directory'|'link'|'other'|'unknown';readonly byteLength:number|null}
export interface DesktopPhotoLinkedPageCurrentV1{readonly entries:readonly Readonly<DesktopPhotoLinkedEntryCurrentV1>[];readonly done:boolean}
import type {DesktopPhotoLinkedInspectionCurrentV1 as Inspection,DesktopPhotoLinkedOriginalPageCurrentV1 as OriginalPage} from './desktop-photo-linked-management-contract-current-v1.ts';
type Options=Readonly<{signal?:AbortSignal}>;
/** Renderer-safe fixed port. IDs resolve only in the authenticated selected
 * Main connection; no path/components, function or scalar body proof is sent. */
export interface DesktopPhotoLinkedLibraryPortCurrentV1{
 inspectOriginal(binding:CatalogOriginalRepairBindingV1,options?:Options):Promise<Readonly<Inspection>>;
 readOriginalsPage(cursor?:string|null,options?:Options):Promise<Readonly<OriginalPage>>;
 chooseFolder(options?:Options):Promise<Readonly<DesktopPhotoLinkedGrantCurrentV1>|null>;
 readGrants(afterGrantId?:string|null,options?:Options):Promise<Readonly<{grants:readonly Readonly<DesktopPhotoLinkedGrantCurrentV1>[];afterGrantId:string|null}>>;
 openScan(grantId:string,entryId?:string,options?:Options):Promise<DesktopPhotoLinkedScanCurrentV1>;
 nextScan(scan:DesktopPhotoLinkedScanCurrentV1,options?:Options):Promise<Readonly<DesktopPhotoLinkedPageCurrentV1>>;
 closeScan(scan:DesktopPhotoLinkedScanCurrentV1):Promise<void>;
 openInput(scan:DesktopPhotoLinkedScanCurrentV1,entryId:string,options?:Options):Promise<Readonly<Input>>;
 readInput(input:DesktopPhotoLinkedInputCurrentV1,offset:number,length:number,options?:Options):Promise<Uint8Array<ArrayBuffer>>;
 closeInput(input:DesktopPhotoLinkedInputCurrentV1):Promise<void>;
 publishInput(input:DesktopPhotoLinkedInputCurrentV1,importId:string,photo:PhotoDocumentCurrentV1,options?:Options):Promise<Readonly<{sourceId:string;sha256:string;size:number}>>;
 relinkInput(input:DesktopPhotoLinkedInputCurrentV1,binding:CatalogOriginalRepairBindingV1,expectedRevision:number,options?:Options):Promise<Readonly<{assetId:string;sha256:string;size:number;revision:number}>>;
 revoke(grantId:string,options?:Options):Promise<boolean>;
 rawImport?(input:DesktopPhotoLinkedInputCurrentV1):Readonly<PhotoLibraryRawImportSourceCurrentV1>;
}
