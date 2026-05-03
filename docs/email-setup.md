# Email Setup — StreamLine + Core Notifications

StreamLine sends transactional email (welcome, EDU account created) through the **`@cores/notifications`** shared module. This document explains how the integration works and how to configure it in development, staging, and production.

---

## Architecture

```
streamline-server/routes/auth.ts          ← trigger: self-service signup
streamline-server/routes/onboarding.ts   ← trigger: EDU top-admin creation
        │
        ▼
streamline-server/lib/emailService.ts    ← StreamLine adapter
        │
        ▼
@cores/notifications (Cores/notifications/)
  ├── loadNotificationConfig()           ← reads env vars
  ├── SendEmailUseCase                   ← orchestrates send + logging
  ├── ResendEmailProvider                ← Resend.com HTTP adapter (DI)
  └── ConsoleEmailProvider               ← dev/test noop
```

**Key principles:**
- StreamLine is responsible for *when* to send (trigger points) and *what* to say (templates in `emailTemplates.ts`).
- `@cores/notifications` is responsible for the provider, config, logging, and validation.
- The `resend` npm package is installed in `streamline-server/` and injected into `ResendEmailProvider` — the Core module itself has no runtime dependencies.
- Email sending is **fire-and-forget** (`setImmediate`) after account creation. A failure never blocks sign-up.

---

## Where the Core module lives

```
Cores/notifications/       ← root of monorepo, referenced as @cores/notifications
├── src/                   ← TypeScript source (authoritative)
├── dist/                  ← pre-compiled CommonJS output (committed, consumed by server)
├── package.json
└── tsconfig.json
```

The server references it via `"@cores/notifications": "file:../Cores/notifications"` in `streamline-server/package.json`.

---

## Environment Variables

All email variables are **server-side only**. Never use `VITE_` prefixes for secrets.

| Variable | Required | Default | Description |
|---|---|---|---|
| `RESEND_API_KEY` | For real delivery | *(none)* | Resend.com API key. Absent → console-only mode. |
| `EMAIL_FROM` | Yes (production) | `noreply@example.com` | Sender address. Must be a verified Resend domain. Example: `StreamLine <noreply@yourdomain.com>` |
| `EMAIL_REPLY_TO` | No | *(none)* | Reply-to address. |
| `EMAIL_SEND_ENABLED` | No | `true` | Set to `false` to disable all outbound email. |
| `EMAIL_LOG_LEVEL` | No | `info` | Logging verbosity: `debug` \| `info` \| `warn` \| `error` \| `silent` |
| `STREAMLINE_APP_URL` | No | Falls back to `CLIENT_URL` | Public frontend URL used in email links, e.g. `https://app.yourdomain.com` |

### Render environment variable setup

Add these to your Render service's environment variables (Settings → Environment):

1. `RESEND_API_KEY` — get from [resend.com/api-keys](https://resend.com/api-keys)
2. `EMAIL_FROM` — e.g. `StreamLine <noreply@yourdomain.com>` (domain must be verified in Resend)
3. `EMAIL_SEND_ENABLED` — set to `true` (already defaults to `true` in `render.yaml`)
4. `STREAMLINE_APP_URL` — your public app URL, e.g. `https://app.yourdomain.com`

---

## Local Development

To develop without sending real email, simply omit `RESEND_API_KEY`. The console provider logs a JSON line to stdout for every attempted send:

```
{"type":"email:console","to":"user@example.com","from":"noreply@example.com","subject":"Welcome to StreamLine","htmlLength":2134}
```

You can also force disable entirely:
```bash
EMAIL_SEND_ENABLED=false
```

---

## Email Triggers

| Event | Template | File |
|---|---|---|
| Self-service signup (`POST /api/auth/signup`) | Welcome | `buildWelcomeEmail()` in `lib/emailTemplates.ts` |
| EDU top-admin creation (`POST /api/onboarding/create-top-admin`) | EDU admin account ready | `buildEduWelcomeEmail()` in `lib/emailTemplates.ts` |
| Successful password reset (`POST /api/auth/forgot-password/reset`) | Password changed security notice | `buildPasswordResetConfirmationEmail()` in `lib/emailTemplates.ts` |
| Admin enables password reset (`POST /api/admin/users/:userId/enable-password-reset`) | Password reset available notification | `buildAdminResetNotificationEmail()` in `lib/emailTemplates.ts` |

### Idempotency

After a successful send, `welcomeEmailSentAt` (ms timestamp) is written to the user's Firestore document (`users/{uid}`). This prevents duplicate welcome emails if the route is retried.

---

## Adding a New Email Template

1. Add a `build*Email()` function to `streamline-server/lib/emailTemplates.ts`.
2. Import and call `sendEmail()` from `streamline-server/lib/emailService.ts` at the appropriate route.
3. The `sendEmail()` function handles validation, the feature flag, and error logging — your route only needs to build the template and call `sendEmail()`.

---

## Rebuilding the Core Module

If you change source files under `Cores/notifications/src/`:

```bash
cd Cores/notifications
npm run build      # outputs to dist/
```

Commit both `src/` and `dist/` changes. The server's TypeScript compiler reads types from `dist/index.d.ts`.

---

## Running Tests

```bash
cd streamline-server
npm test           # builds and runs all lib tests including emailService.test.ts
```

The email tests use the `ConsoleEmailProvider` (no outbound network calls) and cover:
- Valid/invalid email validation
- `EMAIL_SEND_ENABLED=false` short-circuit
- Provider error handling
- Template content and HTML-injection safety
- No sensitive data in template output
