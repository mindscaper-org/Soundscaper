/* SPDX-License-Identifier: AGPL-3.0-only */
import {createHash} from 'node:crypto';
import {readClosedDomainRecord as record,readClosedDomainField as field} from '../src/common/editor/closed-domain-value.ts';
import {normalizePhotoDocumentCurrentV1 as photo} from '../src/lightscaper/catalog/photo-document-current-v1.ts';
import {normalizeCatalogOriginalRepairBindingV1 as binding} from '../src/common/editor/storage/media-catalog-original-repair-contract.ts';
import {readDesktopPhotoLinkedOriginalPageCurrentV1 as admit} from '../src/lightscaper/desktop-photo-linked-management-contract-current-v1.ts';
import type {LightscaperNativeCatalogReadCurrentV1 as Catalog} from './lightscaper-native-catalog-store-current-v1.ts';
import type {LightscaperNativePhotoLinkedOriginalsCurrentV1 as Linked} from './lightscaper-native-photo-linked-originals-current-v1.ts';
import type {PhotoCatalogContinuationV1} from '../src/lightscaper/catalog/repository-types.ts';
/** Only a genuine bound Catalog supplies these captured reads. Each full Photo
 * is admitted separately; the retained page is scalar and bounded to64 rows. */
export async function readLightscaperNativePhotoLinkedInspectionPageCurrentV1(catalog:Catalog,linked:Linked,catalogId:string,cursor:string|null,signal:AbortSignal){
 signal.throwIfAborted();catalog.assertCurrent();const snapshot=await catalog.readSnapshot(catalogId,{signal});if(!snapshot)throw new Error('Selected native catalog is absent.');
 let continuation:PhotoCatalogContinuationV1|null=null;
 if(cursor!==null){const r=record(JSON.parse(cursor) as unknown,'linked inspection continuation',['schemaVersion','catalogId','rootRevision','indexRevision','continuation']);
  if(field(r,'schemaVersion','linked inspection continuation')!==1||field(r,'catalogId','linked inspection continuation')!==catalogId||field(r,'rootRevision','linked inspection continuation')!==snapshot.catalog.revision||field(r,'indexRevision','linked inspection continuation')!==snapshot.indexRevision)throw new Error('Linked inspection catalog changed.');
  continuation=field(r,'continuation','linked inspection continuation') as PhotoCatalogContinuationV1;
 }
 const page=await catalog.readSummaryPage(catalogId,{continuation,signal}),rows=[],fences:Readonly<{id:string;digest:string}>[]=[];
 for(const summary of page.items){signal.throwIfAborted();const document=photo(await catalog.loadPhoto(catalogId,summary.photoId));if(document.id!==summary.photoId||document.catalogId!==catalogId||document.revision!==summary.photoRevision)throw new Error('Linked inspection Photo projection changed.');
  fences.push(Object.freeze({id:document.id,digest:hash(document)}));if(document.original.retention!=='linked')continue;
  const original=document.original,request=binding({catalogId,importId:null,photoId:document.id,assetId:original.storageKey,sourceId:original.id,sha256:original.contentSha256,size:original.byteLength,name:original.name,mimeType:original.mimeType});
  const inspected=await linked.inspect(request,{signal});signal.throwIfAborted();rows.push(Object.freeze({...inspected,photoId:document.id,photoRevision:document.revision,fileName:document.metadata.fileName,binding:request}));
 }
 for(const fence of fences){signal.throwIfAborted();if(hash(photo(await catalog.loadPhoto(catalogId,fence.id)))!==fence.digest)throw new Error('Linked inspection full Photo changed during IO.');}
 const current=await catalog.readSnapshot(catalogId,{signal});signal.throwIfAborted();catalog.assertCurrent();if(!current||current.catalog.revision!==snapshot.catalog.revision||current.indexRevision!==snapshot.indexRevision||hash(current.catalog)!==hash(snapshot.catalog))throw new Error('Linked inspection final catalog fence changed.');
 return admit({catalogId,catalogRevision:snapshot.catalog.revision,rows,cursor:page.continuation===null?null:JSON.stringify({schemaVersion:1,catalogId,rootRevision:snapshot.catalog.revision,indexRevision:snapshot.indexRevision,continuation:page.continuation})},catalogId);
}
function hash(value:unknown):string{return createHash('sha256').update(JSON.stringify(value)).digest('hex');}
