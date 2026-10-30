/* SPDX-License-Identifier: AGPL-3.0-only */
import { readClosedDomainRecord as record, readClosedDomainField as field } from '../common/foundation/closed-domain-value.ts';
import { readDesktopPhotoRawRequestCurrentV1 as request, readDesktopPhotoRawTicketIdCurrentV1 as ticketId } from './desktop-photo-raw-contract-current-v1.ts';
import { readDesktopPhotoLibrarySessionHandleCurrentV1 as handle } from './desktop-photo-library-session-protocol-current-v1.ts';
import { copyDesktopPhotoBytesCurrentV1 as copy, desktopPhotoDigestCurrentV1 as digest } from './desktop-photo-transfer-bytes-current-v1.ts';
const FIELDS: Readonly<Record<string, readonly string[]>> = Object.freeze({ available: [], begin: ['expectedBytes', 'expectedSha256'], write: ['handle', 'sequence', 'offset', 'bytes'], finish: ['handle'], close: ['handle'] });
function integer(value: unknown, maximum: number, minimum = 0): number {
	if (typeof value !== 'number' || !Number.isSafeInteger(value) || Object.is(value, -0) || value < minimum || value > maximum) throw new RangeError('Native RAW packet exceeds its fixed integer bound.'); return value;
}
/** Four fixed purpose channels. RAW output never uses the encoded-body budget. */
export function readDesktopPhotoRawPacketCurrentV1(family: string, value: unknown, catalogId: string): Readonly<Record<string, unknown>> {
	if (family === 'raw-input') {
		const operation = field(value as Record<string, unknown>, 'operation', 'native RAW input packet');
		if (typeof operation !== 'string' || !Object.hasOwn(FIELDS, operation)) throw new TypeError('Unknown fixed native RAW input operation.');
		const p = record(value, 'native RAW input packet', ['operation', ...FIELDS[operation]!]);
		if (operation === 'available') return Object.freeze({ operation });
		if (operation === 'begin') return Object.freeze({ operation, expectedBytes: integer(p.expectedBytes, 67_108_864, 1), expectedSha256: digest(p.expectedSha256) });
		const selected = handle(p.handle, 'raw-input');
		if (operation !== 'write') return Object.freeze({ operation, handle: selected });
		const sequence = integer(p.sequence, Number.MAX_SAFE_INTEGER), offset = integer(p.offset, 67_108_864), bytes = copy(p.bytes);
		if (!bytes.byteLength) throw new RangeError('Native RAW input chunks must contain bytes.');
		return Object.freeze({ operation, handle: selected, sequence, offset, bytes });
	}
	if (family === 'raw-open') {
		const p = record(value, 'native RAW open packet', ['request']), selected = request(p.request);
		if (selected.kind !== 'input' && selected.request.catalogId !== catalogId) throw new TypeError('Native RAW belongs to another selected catalog.');
		return Object.freeze({ request: selected });
	}
	if (family !== 'raw-read' && family !== 'raw-close') throw new TypeError('Unknown native RAW output channel.');
	const p = record(value, 'native RAW ticket packet', family === 'raw-read' ? ['ticket', 'offset', 'length'] : ['ticket']);
	const ticket = Object.freeze({ id: ticketId(p.ticket) });
	return Object.freeze(family === 'raw-read' ? { ticket, offset: integer(p.offset, 268_435_456), length: integer(p.length, 1_048_576, 1) } : { ticket });
}
