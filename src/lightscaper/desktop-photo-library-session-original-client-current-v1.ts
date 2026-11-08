/* SPDX-License-Identifier: AGPL-3.0-only */

import type { DesktopPhotoLibrarySessionStorageCurrentV1 as Storage } from './desktop-photo-library-session-storage-current-v1.ts';
import { DesktopPhotoSessionClientCallsCurrentV1 as Calls, desktopPhotoVoidCurrentV1 as empty } from './desktop-photo-library-session-client-calls-current-v1.ts';
import { readDesktopPhotoOriginalRequestCurrentV1 as request, readDesktopPhotoOriginalTicketCurrentV1 as ticket,
	readDesktopPhotoOriginalTicketIdCurrentV1 as ticketId } from './desktop-photo-original-contract-current-v1.ts';
import { readDesktopPhotoOriginalGroupTicketCurrentV1 as groupTicket } from './desktop-photo-original-group-contract-current-v1.ts';
import { copyDesktopPhotoBytesCurrentV1 as copy } from './desktop-photo-library-session-transfer-client-current-v1.ts';
import { array } from './catalog/value-validation.ts';

export function createDesktopPhotoSessionOriginalTransportCurrentV1(c: Calls): Storage['components']['originalTickets']['transport'] {
	return Object.freeze<Storage['components']['originalTickets']['transport']>({
		open: value => c.own(() => { const captured = request(value); c.catalog(captured.catalogId);
			return c.send('originalOpen', () => ({ request: captured }), v => ticket(v, captured), undefined, false, true); }),
		read: (value, offset, length) => c.send('originalRead', () => ({ ticket: value, offset, length }), v => { const bytes = copy(v); if (bytes.byteLength !== length) { bytes.fill(0); throw new TypeError('Native Original range length mismatch.'); } return bytes; }),
		close: value => c.send('originalClose', () => ({ ticket: { id: ticketId(value) } }), empty, undefined, true, true),
		openGroup: values => c.own(() => {
			const requests = Object.freeze(array(values, 'Original group requests', 1, 4094).map(v => { const captured = request(v); c.catalog(captured.catalogId); return captured; }));
			return c.send('originalOpenGroup', () => ({ requests }), v => groupTicket(v, requests), undefined, false, true);
		}),
		readGroup: (value, index, offset, length) => c.send('originalReadGroup', () => ({ group: { id: ticketId(value) }, index, offset, length }), v => { const bytes = copy(v); if (bytes.byteLength !== length) { bytes.fill(0); throw new TypeError('Native Original group range mismatch.'); } return bytes; }),
		closeGroup: value => c.send('originalCloseGroup', () => ({ group: { id: ticketId(value) } }), empty, undefined, true, true),
	});
}
