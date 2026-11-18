/* SPDX-License-Identifier: AGPL-3.0-only */

import { useEffect, useRef, useState } from 'react';

export function useSearchQueryDraft(committedQuery: string) {
	const [query, setQuery] = useState(committedQuery);
	const previousQuery = useRef(committedQuery);
	useEffect(() => {
		// A delayed mount effect must preserve the first typed search draft.
		if (previousQuery.current === committedQuery) return;
		previousQuery.current = committedQuery;
		setQuery(committedQuery);
	}, [committedQuery]);
	return [query, setQuery] as const;
}
