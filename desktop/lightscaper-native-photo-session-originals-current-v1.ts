/* SPDX-License-Identifier: AGPL-3.0-only */

import type { LightscaperNativePhotoSessionLeaseCurrentV1 as Lease } from './lightscaper-native-photo-session-lease-current-v1.ts';
import type { PhotoLibraryOriginalRequestCurrentV1 } from '../src/lightscaper/controller/photo-library-original-source-current-v1.ts';
import type { DesktopPhotoOriginalTicketCurrentV1 } from '../src/lightscaper/desktop-photo-original-contract-current-v1.ts';
const CHECK = AbortSignal.prototype.throwIfAborted;
export async function dispatchLightscaperNativePhotoSessionOriginalCurrentV1(lease: Lease, family: string, p: Readonly<Record<string, unknown>>, signal: AbortSignal): Promise<unknown> {
	const transport = lease.components.originalTickets.transport;
	if (family === 'original-close') return transport.close(p.ticket as { id: string });
	if (family === 'original-close-group') return transport.closeGroup!(p.group as { id: string });
	if (family === 'original-read') return transport.read(p.ticket as DesktopPhotoOriginalTicketCurrentV1, p.offset as number, p.length as number);
	if (family === 'original-read-group') return transport.readGroup!(p.group as { id: string }, p.index as number, p.offset as number, p.length as number);
	const group = family === 'original-open-group';
	const result = group ? await transport.openGroup!(p.requests as readonly PhotoLibraryOriginalRequestCurrentV1[]) : await transport.open(p.request as PhotoLibraryOriginalRequestCurrentV1);
	try { Reflect.apply(CHECK, signal, []); return result; }
	catch (primary) {
		// Cancelled acquisition never publishes an orphan token. The actual
		// issued registry ID is joined on the independent cleanup lane.
		const ticket = { id: (result as { id: string }).id };
		try { if (group) await transport.closeGroup!(ticket); else await transport.close(ticket); }
		catch (cleanup) { throw new AggregateError([primary, cleanup], 'Native Original acquisition and retirement failed.', { cause: cleanup }); }
		throw primary;
	}
}
