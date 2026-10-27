# Editor and handbook localization

English is the source language. The editor and handbook use the same translation
models; their authoring tools are separate from builds and deterministic checks.

## Editor catalogs

Every non-English locale is served by one committed catalog under
`src/common/i18n/translations/`. Each entry records its English source and one
ownership tag:

| Tag | Owner |
| --- | --- |
| `machine` | Automatic translation tooling |
| `audacity` | Weekly Audacity sync, with GPL-3.0 strings and their notice |
| `human` | A person maintaining the translation |

Automatic writers may replace `machine` and `audacity` entries, never `human`
entries. To correct an automatic translation by hand, change its tag to `human`
along with its text. Do not hand-edit entries while retaining an automatic tag,
or edit the generated loader index.

Changing English retires a translation until its recorded source matches again;
the runtime falls back to English. Regenerate automatic entries with
`npm run i18n:translate -- --all` or the Audacity sync. Human entries remain
owned by their authors and are reported stale for manual correction.

See the [editor translation tooling](../../scripts/i18n-ai/README.md) for
catalog schemas, locale routes, model selection, commands, and provenance, and
[community contributions](../../CONTRIBUTING.md#community-translations) for
reviewing and importing human translations.

## Handbook languages

English pages live under `handbook/src/content/docs/`. A translated language
lives under `handbook/src/content/docs/<lowercased-tag>/`; the presence of that
tree publishes the language. Translate missing or
outdated pages and report remaining work with:

```sh
npm run docs:translate:handbook -- --locale fr
npm run docs:translate:check
```

Write handbook body links without a site base or language prefix. Give linked
headings explicit IDs such as `{#the-id}` so translated headings retain stable
targets. Add a newly published language to `HANDBOOK_LANGUAGES` in
`src/common/editor/documentation-links.ts` so editor help opens the translated
handbook.

See the [handbook translation tooling](../../scripts/docs-ai/README.md) for
models, validation, navigation translation, and source provenance.
