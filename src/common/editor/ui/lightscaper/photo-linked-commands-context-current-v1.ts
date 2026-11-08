/* SPDX-License-Identifier: AGPL-3.0-only */
import {createContext} from 'react';
import type {PhotoLibraryLinkedCommandsCurrentV1} from '../../controller/composition/photo-library-linked-commands-current-v1.ts';
export const PhotoLinkedCommandsContextCurrentV1=createContext<PhotoLibraryLinkedCommandsCurrentV1|null>(null);
