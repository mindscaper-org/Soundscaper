/* SPDX-License-Identifier: AGPL-3.0-only */
import type {DatabaseSync} from 'node:sqlite';
import {randomBytes,randomUUID} from 'node:crypto';
import {PENDING_SOURCE_RETENTION_MS} from '../src/common/editor/storage/source-write-common.ts';
import {catalogOriginalKey,catalogOriginalScope,normalizeCatalogOriginalRoot} from '../src/common/editor/storage/media-catalog-original-schema.ts';
import {readLightscaperNativePhotoMediaIdentityCurrentV1 as typedIdentity} from './lightscaper-native-photo-media-identity-current-v1.ts';
import {readLightscaperNativePhotoMediaMetadataCurrentV1 as metadata,type LightscaperNativePhotoMediaMetadataCurrentV1 as Metadata} from './lightscaper-native-photo-media-metadata-current-v1.ts';
import {readLightscaperNativePhotoMediaDescriptiveCurrentV1 as readMetadata} from './lightscaper-native-photo-media-assets-current-v1.ts';
import {createLinkedGrantCleanupFailureCurrentV1 as cleanup} from './lightscaper-native-photo-linked-grants-failures-current-v1.ts';
import {encodeLinkedLocatorCurrentV1} from './lightscaper-native-photo-linked-locator-current-v1.ts';
import type {LinkedInputStateCurrentV1 as Input} from './lightscaper-native-photo-linked-input-current-v1.ts';
import type {PhotoOriginalV1} from '../src/lightscaper/catalog/types.ts';
export function publishLinkedOriginalCurrentV1(db:DatabaseSync,input:Input,packet:Readonly<{catalogId:string;importId:string;photoId:string;original:Readonly<PhotoOriginalV1>;metadata:Metadata}>,check:()=>void,acknowledge:()=>void):Record<string,unknown>{
	if(db.isTransaction)throw new Error('Linked publication requires its own transaction.');check();
	const binding=input.input.facts,descriptive=metadata(packet.metadata),locator=encodeLinkedLocatorCurrentV1(input.captured,input.file.identity),locatorId=randomBytes(32).toString('hex');
	const detached=readMetadata(descriptive.metadataPayload);
	if(descriptive.assetId!==binding.sourceId)throw new Error('Linked metadata belongs to another input.');
	const committedAt=new Date().toISOString(),pendingUntil=new Date(Date.parse(committedAt)+PENDING_SOURCE_RETENTION_MS).toISOString(),token=`media-content-${randomUUID()}`;
	const root=normalizeCatalogOriginalRoot({schemaVersion:1,key:catalogOriginalKey(packet.catalogId,packet.importId,packet.photoId),scope:catalogOriginalScope(packet.catalogId,packet.importId),
		catalogId:packet.catalogId,importId:packet.importId,photoId:packet.photoId,assetId:binding.sourceId,sourceId:packet.original.id,sha256:binding.contentSha256,size:binding.byteLength,mediaContentToken:token});
	db.exec('BEGIN IMMEDIATE');
	try{
		check();if(db.prepare('SELECT 1 FROM native_photo_original_bindings WHERE storage_key=?').get(binding.sourceId))throw new Error('Linked input collides with a managed binding.');
		db.prepare('INSERT INTO native_photo_linked_original_bindings(storage_key,content_sha256,byte_length,grant_id,locator_id,revision,locator) VALUES(?,?,?,?,?,0,?)')
			.run(binding.sourceId,binding.contentSha256,binding.byteLength,input.captured.row.grant.grantId,locatorId,locator);
		db.prepare("INSERT INTO native_photo_media_identities(source_id,kind,sha256,size,managed_key,linked_key) VALUES(?,'linked',?,?,NULL,?)").run(binding.sourceId,binding.contentSha256,binding.byteLength,binding.sourceId);
		db.prepare('INSERT INTO native_photo_media_assets(source_id,sha256,size,media_content_token,metadata,root_count,committed_at,pending_until) VALUES(?,?,?,?,?,1,?,?)')
			.run(binding.sourceId,binding.contentSha256,binding.byteLength,token,descriptive.metadataPayload,committedAt,pendingUntil);
		db.prepare('INSERT INTO native_photo_media_roots(root_key,scope_key,asset_id,root) VALUES(?,?,?,?)').run(utf16(root.key),utf16(root.scope),binding.sourceId,JSON.stringify(root));
		const row=db.prepare(`SELECT CASE WHEN length(CAST(a.sha256 AS BLOB))=64 THEN a.sha256 END AS sha256,a.size,
		 CASE WHEN length(CAST(a.media_content_token AS BLOB))<=142 THEN a.media_content_token END AS media_content_token,a.root_count,
		 CASE WHEN length(CAST(a.committed_at AS BLOB))<=32 THEN a.committed_at END AS committed_at,CASE WHEN length(CAST(a.pending_until AS BLOB))<=32 THEN a.pending_until END AS pending_until,
		 CASE WHEN length(a.metadata)=? THEN a.metadata END AS metadata,CASE WHEN length(CAST(l.grant_id AS BLOB))=64 THEN l.grant_id END AS grant_id,CASE WHEN length(CAST(l.locator_id AS BLOB))=64 THEN l.locator_id END AS locator_id,l.revision,
		 CASE WHEN length(l.locator)<=65536 THEN l.locator END AS locator,CASE WHEN length(CAST(i.kind AS BLOB))<=16 THEN i.kind END AS kind,CASE WHEN length(CAST(i.linked_key AS BLOB))<=128 THEN i.linked_key END AS linked_key,i.managed_key IS NULL AS managed_absent,
		 CASE WHEN length(r.root_key)<=4096 THEN r.root_key END AS root_key,CASE WHEN length(r.scope_key)<=4096 THEN r.scope_key END AS scope_key,CASE WHEN length(CAST(r.asset_id AS BLOB))<=128 THEN r.asset_id END AS asset_id,
		 CASE WHEN length(CAST(r.root AS BLOB))<=2048 THEN r.root END AS root FROM native_photo_media_assets a
		 JOIN native_photo_linked_original_bindings l ON l.storage_key=a.source_id JOIN native_photo_media_identities i ON i.source_id=a.source_id
		 JOIN native_photo_media_roots r ON r.root_key=? WHERE a.source_id=?`).get(descriptive.metadataPayload.byteLength,utf16(root.key),binding.sourceId);
		if(!row||row.sha256!==binding.contentSha256||row.size!==binding.byteLength||row.media_content_token!==token||row.root_count!==1||row.committed_at!==committedAt||row.pending_until!==pendingUntil
		 ||row.kind!=='linked'||row.linked_key!==binding.sourceId||row.managed_absent!==1||row.grant_id!==input.captured.row.grant.grantId||row.locator_id!==locatorId||row.revision!==0
		 ||!same(row.root_key,utf16(root.key))||!same(row.scope_key,utf16(root.scope))||row.asset_id!==binding.sourceId||!same(row.metadata,descriptive.metadataPayload)||!same(row.locator,locator)||row.root!==JSON.stringify(root))throw new Error('Linked publication was rewritten or incomplete.');
		if(typedIdentity(db,{storageKey:binding.sourceId,contentSha256:binding.contentSha256,byteLength:binding.byteLength})!=='linked')throw new Error('Linked typed tuple changed.');
		check();db.exec('COMMIT');acknowledge();
	}catch(primary){try{if(db.isTransaction)db.exec('ROLLBACK');}catch(error){throw cleanup([primary,error],'Linked publication rollback failed.');}throw primary;}
	// Captured inert metadata is decoded before SQL; after ACK no caller/owner
	// cancellation check or arbitrary callback can retract the durable receipt.
	return {...detached,sourceId:binding.sourceId,sha256:binding.contentSha256,size:binding.byteLength,storage:'native-photo-linked-original',committedAt,pendingProjectUntil:pendingUntil};
}
function same(value:unknown,expected:Uint8Array):boolean{return value instanceof Uint8Array&&value.byteLength===expected.byteLength&&value.every((byte,index)=>byte===expected[index]);}
export function linkedUtf16CurrentV1(value:string):Uint8Array{return utf16(value);}
function utf16(value:string):Uint8Array{const bytes=new Uint8Array(value.length*2);for(let i=0;i<value.length;i++){const unit=value.charCodeAt(i);bytes[i*2]=unit>>>8;bytes[i*2+1]=unit&255;}return bytes;}
