/* SPDX-License-Identifier: AGPL-3.0-only */
import type {DatabaseSync} from 'node:sqlite';
import {readLightscaperNativeOriginalBindingCurrentV1,type LightscaperNativeOriginalBindingCurrentV1 as Binding} from './lightscaper-native-original-index-current-v1.ts';
import {linkedGrantIdCurrentV1 as id} from './lightscaper-native-photo-linked-grants-records-current-v1.ts';
import {decodeLinkedLocatorCurrentV1,type LinkedLocatorCurrentV1} from './lightscaper-native-photo-linked-locator-current-v1.ts';
export interface LinkedOriginalRowCurrentV1 {readonly binding:Readonly<Binding>;readonly grantId:string;readonly locatorId:string;readonly revision:number;readonly locator:Readonly<LinkedLocatorCurrentV1>}
/** CASE bounds are atomic with delivery, including corrupt CHECK-bypassed rows. */
export function readLinkedOriginalRowCurrentV1(db:DatabaseSync,key:string):Readonly<LinkedOriginalRowCurrentV1>{
	const row=db.prepare(`SELECT CASE WHEN typeof(storage_key)='text' AND length(CAST(storage_key AS BLOB)) BETWEEN 1 AND 128 THEN storage_key END AS storage_key,
	 CASE WHEN typeof(content_sha256)='text' AND length(CAST(content_sha256 AS BLOB))=64 THEN content_sha256 END AS content_sha256,byte_length,
	 CASE WHEN typeof(grant_id)='text' AND length(CAST(grant_id AS BLOB))=64 THEN grant_id END AS grant_id,
	 CASE WHEN typeof(locator_id)='text' AND length(CAST(locator_id AS BLOB))=64 THEN locator_id END AS locator_id,revision,
	 CASE WHEN typeof(locator)='blob' AND length(locator) BETWEEN 1 AND 65536 THEN locator END AS locator FROM native_photo_linked_original_bindings WHERE storage_key=?`).get(key);
	if(!row||row.storage_key!==key||typeof row.revision!=='number'||!Number.isSafeInteger(row.revision)||row.revision<0||!(row.locator instanceof Uint8Array))throw new Error('Linked native locator is absent or malformed.');
	return Object.freeze({binding:readLightscaperNativeOriginalBindingCurrentV1({storageKey:row.storage_key,contentSha256:row.content_sha256,byteLength:row.byte_length}),grantId:id(row.grant_id),locatorId:id(row.locator_id),revision:row.revision,locator:decodeLinkedLocatorCurrentV1(row.locator)});
}
