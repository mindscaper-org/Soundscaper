/* SPDX-License-Identifier: AGPL-3.0-only */
import {useContext,useEffect} from 'react';
import {PhotoLinkedCommandsContextCurrentV1} from './photo-linked-commands-context-current-v1.ts';
import type {ExecutePhotoOriginalRecoveryV1} from './use-photo-original-recovery.ts';
/** Register only the Current complete workflow; its existing destination
 * registry owns accepted menu/poll work through actual generation retirement. */
export function usePhotoLinkedWorkflowCurrentV1(current:boolean,execute:ExecutePhotoOriginalRecoveryV1,register:(close:()=>Promise<void>)=>()=>void):void{
 const owner=useContext(PhotoLinkedCommandsContextCurrentV1);useEffect(()=>{if(!current||!owner)return;return owner.register(execute,register);},[current,owner,execute,register]);
}
