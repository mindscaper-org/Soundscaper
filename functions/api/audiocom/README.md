# audio.com integration

The menu-opened audio.com panel searches listed audio, previews playback, and
uploads supported audio files. Audiocity serves original audio; Soundscaper decodes
WavPack and AIFF previews locally using its existing codecs. These decoded previews
are limited to 64 MiB of source audio and 128 MiB of PCM. Recording links open
Audiocity's HTML player. The backend also provides a route to list owned audio.
The default provider uses the
[public v1 API](https://api.audio.com/v1/docs), checked on 2026-10-15.
Both audio.com and a selected Audiocity server use the same Audacity-compatible
project synchronization protocol. The server URL is selected in Advanced settings.

## Server preferences

audio.com is always the editor's default server, including when loading older
preferences. Open **Edit → Preferences → Advanced**, enter the **Server URL**
of an Audiocity instance, and save to select it for this browser or desktop
profile. **Use audio.com** restores `https://api.audio.com`. The panel remains an
opt-in entry under **Window → audio.com**.

When connected, the bottom **Upload audio** action renders the current mix into
the publication dialog. **Save project** saves the open project and creates a new
revision of the same cloud project on subsequent saves. Refresh after another
editor saves; a stale head reports a conflict and requires an explicit retry.
There are no separate archive-file or revision upload controls.

The selected server must be a public HTTPS origin reachable by the Soundscaper
service. A local HTTP Audiocity server works with a locally running Soundscaper
Pages server that explicitly enables local development. Cloudflare cannot use
the browser's localhost address to reach a server on the user's computer.

Each custom connection dynamically registers its own public OAuth client with
the selected server. No administrator redeploy, shared client secret, or manual
client ID entry is needed. Saving another server cancels the previous panel's
search, preview and queued uploads, including when the panel is closed, and
requires reconnecting. Existing provider credentials never follow the selection.

## Deployment

1. Register an OAuth client with audio.com for Soundscaper, including the exact
   redirect URI `https://soundscaper.org/api/audiocom/oauth/callback`. Registration
   is an administrator setup action, not something the browser performs.
   The provider's [authorization server metadata](https://api.audio.com/.well-known/oauth-authorization-server)
   advertises `https://api.audio.com/auth/authorize`, `/auth/token`, and
   `/auth/client`, PKCE S256, and public or confidential clients.
2. Configure Pages secrets `AUDIOCOM_CLIENT_ID` and `AUDIOCOM_OAUTH_MASTER_KEY`.
   The latter is `v1:` followed by the unpadded base64url encoding of 32 random
   bytes. Configure `AUDIOCOM_CLIENT_SECRET` only for a confidential registration
   using `client_secret_post`. The master key and optional client secret remain
   server-side; the public client ID appears in the authorization URL.
3. Apply the audio.com migrations starting at `0002_audiocom.sql` to the existing
   `FREESOUND_OAUTH_DB` binding. audio.com uses separate `audiocom_oauth_*` tables;
   it does not reuse Freesound grants or encryption keys. Both migrations can be
   applied with `npx wrangler d1 migrations apply FREESOUND_OAUTH_DB --remote`.
   Migration `0003_audiocom_provider_binding.sql` adds nullable issuer/client
   bindings to attempts and grants without replacing existing records.
4. The optional `AUDIOCOM_OAUTH_REDIRECT_URI` must have the exact callback path
   above on `https://soundscaper.org` (no query, fragment, credentials or port).
   `AUDIOCOM_LOCAL_DEVELOPMENT=1` admits same-origin loopback HTTP for local tests.

No production application registration, schema migration, remote upload, or
deployment is performed automatically by the integration.

The production public client and independent encryption key were provisioned on
2026-10-15 with the exact `soundscaper.org` callback. Migrations 0002 and 0003 were
applied to the production binding; preview has its separate database and key.

### PR previews

The Pages project is `soundscaper`, with hostname `soundscaper-5ki.pages.dev`.
Its preview environment uses the separate `soundscaper-audiocom-preview` D1
database configured in `wrangler.jsonc`; production keeps its existing binding.
Apply all pending migrations to preview with:

```sh
npx wrangler d1 migrations apply FREESOUND_OAUTH_DB --remote --env preview
```

Preview sign-in requires an explicitly configured, registered callback on this
Pages project. The current preview client is registered for
`https://feat-audio-com-integration.soundscaper-5ki.pages.dev/api/audiocom/oauth/callback`.
Its client ID, independent encryption key, and exact redirect URI are stored as
`AUDIOCOM_CLIENT_ID`, `AUDIOCOM_OAUTH_MASTER_KEY`, and
`AUDIOCOM_OAUTH_REDIRECT_URI` in the Pages **preview** secret store. Secrets and
registration responses must never be committed. An administrator can register a
public client at `/auth/client` with `token_endpoint_auth_method: "none"`,
`scope: "all"`, and the exact `redirect_uris`, then provision these secrets
with `npx wrangler pages secret bulk <protected-json-file> --project-name
soundscaper --env preview`.

Cloudflare deploys this repository's PR branches automatically. Both immutable
deployment URLs and branch aliases can initiate authorization; the provider
returns to the stable registered branch callback. The original editor polls its
own origin and receives a host-only session cookie there. Preview starts without
an explicit preview callback, callbacks on other Pages projects, and production
callbacks from previews are rejected. The callback deployment and originating
deployment must use the same preview database, key, and client registration.
Changing the configured branch callback requires registering the new exact URI
and redeploying. These preview credentials do not configure production OAuth.

## Validate against Audiocity locally

With dependencies installed in both checkouts and Audiocity at `../audiocity`
(or `SCAPE_AUDIOCITY_CHECKOUT`), run:

```sh
npm run build
npx playwright test --config playwright.audiocity.config.mjs
```

The browser harness starts its own Audiocity process, disposable data directory,
registered public OAuth client, local D1 database and Soundscaper Pages preview.
It uses editor port 4325 and Audiocity port 8091; `PLAYWRIGHT_PORT` and
`SCAPE_AUDIOCITY_PORT` override them. The test performs real OAuth authorization,
upload, search, range playback and native project synchronization against the local
HTTP server, including WavPack and AIFF original previews and the HTML player link.
Revision scenarios use valid AUP3/AUP4 files with different project contents and
SHA-256 hashes for successive saves. They verify repeated OAuth login, retained
history, native PCM hashes, block reuse, competing saves, cancellation during transfer and
after byte confirmation, failed completion, and a lost successful response. The
disposable loopback harness injects those failures; production has no fault routes.
It does not contact audio.com or use production credentials. To keep
a disposable validation server running for manual inspection, run
`node scripts/audiocity-validation-server.mjs`; open its printed editor URL and
sign in as `soundscaper-validation@example.test` with the test-only password
`soundscaper-audiocity-test-only-password`. Stop it after validation. Its generated
configuration and credentials stay in ignored temporary files and are removed on exit.

For a locally running Soundscaper Pages server, configure these backend variables:

```text
AUDIOCOM_LOCAL_DEVELOPMENT=1
AUDIOCOM_OAUTH_MASTER_KEY=v1:<base64url-32-random-bytes>
```

Select `http://127.0.0.1:8088` in Advanced preferences. Soundscaper registers a
public client at `/auth/client` using its exact local callback, for example
`http://127.0.0.1:4325/api/audiocom/oauth/callback`; do not copy Audacity's
compatibility client secret or audio.com's credentials.
Keep the master key in ignored `.dev.vars` or the deployment secret store, and
apply the same local D1 migrations as the default provider. The editor and
callback must use the same hostname and port. HTTP is admitted only for an
explicitly enabled loopback development origin. Hosted Audiocity origins require
HTTPS, with no URL path, credentials, query or fragment.

Client requests carry `X-Audiocom-Api-Origin`, defaulting to audio.com regardless
of legacy deployment overrides. The backend validates the selection and pins the
issuer, registered public client ID, scope and callback in D1 attempts and grants.
Callbacks and refresh use this persisted binding. Authenticated requests must
match the selected issuer; headerless audio-element previews use their grant's
issuer. The default retains audio.com's exact API and CDN pins. API, OAuth,
capability hooks and media for Audiocity use one origin with exact route and
capability shapes. Upload and hook URLs accept legacy token-only queries and the
current token with `X-Amz-Date` and `X-Amz-Expires` hints. These URLs retain their
complete validated query and never receive the provider OAuth bearer token.
Failed audio transfers attempt owner-API deletion of their Audiocity recording;
failed archive transfers attempt deletion of their abandoned revision, with
synchronized revisions protected by the server. Cleanup survives caller cancellation
and expired upload capabilities; provider outages or revoked owner access can still
prevent it. Changing origin requires reconnecting.
Both services request Audacity's `all` OAuth scope at authorization, token exchange,
and refresh. Reconnect existing narrower-scope sessions before saving projects.
There is no Audiocity-only project capability discovery or whole-file transport.

## Public contracts

All routes are under `/api/audiocom`. Responses use `{data: ...}` or
`{error:{code,message}}`, are not cached, and admit only Soundscaper web and
desktop origins. Mutations require a trusted origin and reject cross-site fetch
metadata. Web authentication uses a Secure, HttpOnly, SameSite=Strict host cookie.
Desktop authentication uses an opaque Soundscaper capability. Provider tokens and
PKCE verifiers are encrypted with AES-GCM and provider-specific authenticated data
in D1. Refresh-token rotation is serialized with a D1 lease.

- `POST /oauth/start`: JSON `{client:'web'|'desktop'}` returns an attempt,
  handoff capability, expiry, and authorization URL with the configured provider's scope and S256.
- `GET /oauth/callback`: exchanges the code server-side, verifies state, and
  returns a close-window page. No private account endpoint is called: the public
  API has no userinfo route, so sessions do not invent account identity.
- `POST /oauth/poll`: JSON `{attemptId,handoffToken}` returns 202 pending or
  200 connected. Only desktop receives an opaque app session capability.
- `GET /oauth/session` restores the connection; `DELETE` disconnects it and
  removes the last orphaned local grant.
- `GET /search?q=...&page=1` searches only audio; `GET /library?page=1` lists
  owned audio. Both return `{results,page,hasNext}` in pages of ten. An extra
  empty page may be necessary because the public API exposes no result total.
- `GET /preview?url=...` streams approved playback URLs. The proxy pins exact
  HTTPS CDN hosts and path prefixes (`s3.audio.com/audio/` and
  `s3.ustatik.com/audio.com.audio/`), blocks redirects, validates audio content,
  limits transfers to 128 MiB, forwards simple byte ranges, and never forwards
  provider credentials to storage.
- `POST /uploads` receives raw audio bytes with an audio MIME type,
  `X-Audiocom-Filename` (URI-encoded filename) and
  `X-Audiocom-Content-Length` (exact decimal bytes). Query parameters are `title`,
  `category`, `description`, `license`, `listed=0|1`, and `downloadable=0|1`.
  The server creates an upload policy, streams exactly the declared bytes to its
  pinned storage URL, and invokes the policy's POST success hook. In addition
  to the CDN paths above, upload policies admit the exact Wasabi destination
  `https://s3.eu-central-1.wasabisys.com/audio.com.audio/source/`; this source
  bucket is not admitted for playback or source download. Failure or
  cancellation invokes the DELETE failure hook with an independent timeout.
  The audio.com response is `{audio,processing:true}`; completion of transcoding
  is not claimed. Audiocity commits the preserved original synchronously and
  returns `processing:false`, refreshing ready playback metadata when available.
  A failed metadata refresh does not make the committed upload retryable. Signed
  upload URLs and hooks remain server-side.
- `GET /usage` reports the public provider configuration and upload limits. For
  audio.com these are a 100,000,000-byte application cap, the provider's 1 GiB cap,
  and `projectStorageSupported:false`. For Audiocity it discovers the provider cap
  and advertised `projectFormats`; the application cap is the smaller of that
  value and 100,000,000. Limits describe transfers, rather than account quota.
- `GET /projects?page=1` lists the connected owner's cloud projects and their
  latest synchronized revisions through the standard `/project` API.
- `POST /projects?phase=prepare` takes bounded JSON `{name,blocks,id?,head?}`.
  Native uppercase SHA-256 block hashes select missing WavPack blocks; existing
  projects require an expected snapshot head. The response contains only project
  and snapshot IDs and missing hashes, never signed storage URLs.
- `POST /projects?phase=part&project=...&snapshot=...&hash=...` streams a missing
  tagged mono float32 WavPack block. Omitting `hash` transfers the binary XML
  metadata frame. Parts use `application/octet-stream` and an exact
  `X-Audiocom-Content-Length`, with a 100 MB ceiling. Provider policies are
  revalidated server-side before each signed PUT and success hook.
- `POST /projects?phase=complete&project=...&snapshot=...` completes synchronization
  after all parts are confirmed. `DELETE /projects?project=...&snapshot=...`
  retires only an unfinished snapshot. Completed snapshots cannot be deleted
  through this cancellation route, including after a lost completion response.

The project adapter uses Soundscaper's existing AUP3 serializer, SQLite and
WavPack workers. It keeps one decoded block in memory and uploads only missing
blocks. See [native protocol research](../../../docs/research/audio-com-project-sync.md).
