# StreamLounge

StreamLounge is a high-performance creator interaction and stream monetization platform built with Next.js App Router, Supabase, and Razorpay. It allows live streamers to receive viewer-triggered alerts in OBS Studio, including custom TTS text messages, voice notes, soundboard clips, AI stickers, spin wheels, and stream tasks.

---

## 1. System Architecture

- **Web Framework:** Next.js 16 (App Router), React 19, TypeScript 5, Tailwind CSS
- **Authentication & Database:** Supabase (PostgreSQL with Row-Level Security)
- **Private Audio Storage:** Supabase Storage (`soundboard-audio` private bucket with signed URLs and proxy streaming)
- **Payment Processing:** Razorpay Gateway (Server-authoritative pricing, order binding, HMAC checkout verification, and idempotent webhooks)
- **OBS Browser Source Overlay:** Atomic single-event polling, signed HMAC event tokens, state machine transitions, and customizable visual themes
- **Third-Party Integrations:** Google YouTube Data API v3 (OAuth & live chat/stream synchronization), OpenAI API (DALL-E AI Stickers and Text-to-Speech)

---

## 2. Environment Configuration

Copy `.env.example` to `.env.local` for local development:

```bash
cp .env.example .env.local
```

### Environment Variables Reference

| Variable | Environment | Description |
| :--- | :--- | :--- |
| `NEXT_PUBLIC_APP_URL` | Local & Prod | Canonical base URL (e.g., `http://localhost:3000` in dev, `https://streamlounge.com` in prod). Used for OAuth redirects. |
| `NEXT_PUBLIC_SUPABASE_URL` | Local & Prod | Supabase Project URL (`https://<project-ref>.supabase.co`). |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Local & Prod | Supabase public anonymous API key for client and server SSR sessions. |
| `RAZORPAY_KEY_ID` | Local & Prod | Razorpay Key ID (`rzp_test_...` or `rzp_live_...`). Served to client dynamically per order. |
| `RAZORPAY_KEY_SECRET` | Local & Prod | **Server-Only.** Razorpay Key Secret for checkout verification and API queries. |
| `RAZORPAY_WEBHOOK_SECRET` | Production | **Server-Only.** Webhook secret configured in Razorpay Dashboard for `/api/payments/webhook`. |
| `OVERLAY_SIGNING_SECRET` | Recommended | **Server-Only.** Dedicated HMAC key for signing OBS event tokens. Falls back to `RAZORPAY_KEY_SECRET`. |
| `PAYMENT_SIGNING_SECRET` | Optional | **Server-Only.** Dedicated HMAC key for internal verified payment tokens. Falls back to `RAZORPAY_KEY_SECRET`. |
| `GOOGLE_CLIENT_ID` | Optional | Google OAuth 2.0 Client ID for YouTube channel connection and sync. |
| `GOOGLE_CLIENT_SECRET` | Optional | Google OAuth 2.0 Client Secret for YouTube channel connection. |
| `OPENAI_API_KEY` | Optional | OpenAI API key for AI Stickers (`/api/stickers/generate`) and TTS (`/api/tts`). |

> **Security Note:** Service role keys and payment secrets must NEVER be committed to Git or exposed in client components.

---

## 3. Database Schema & Supabase Setup

StreamLounge enforces creator data isolation via PostgreSQL Row-Level Security (RLS).

### Database Migrations

SQL migration files are located in `docs/sql/`:

1. **Overlay Theme Persistence:**
   Run [`docs/sql/add_overlay_theme.sql`](file:///docs/sql/add_overlay_theme.sql) in your Supabase SQL Editor:
   ```sql
   ALTER TABLE public.creator_profiles
   ADD COLUMN IF NOT EXISTS overlay_theme text DEFAULT 'gold';
   ```

2. **YouTube Tokens Storage:**
   Run [`docs/sql/create_creator_youtube_tokens.sql`](file:///docs/sql/create_creator_youtube_tokens.sql) to enable YouTube OAuth persistence with RLS.

3. **Public Interactions Access RPC:**
   Run [`docs/sql/get_public_interactions.sql`](file:///docs/sql/get_public_interactions.sql) to allow public viewer pages to query active creator interactions safely without exposing private configuration.

### Storage Bucket Configuration

- Bucket Name: `soundboard-audio`
- Public Access: **DISABLED (Private)**
- Access Model: Served via short-lived signed URLs (`createSignedUrl(path, 3600)`) and authenticated proxy route (`/api/overlay/soundboard`).

---

## 4. OBS Browser Source Setup

1. Open OBS Studio or Streamlabs.
2. In your Scene, add a new **Browser Source**.
3. Set the **URL** to:
   ```
   https://<your-domain>/obs/<creator_username>?theme=<theme_name>
   ```
4. Set dimensions:
   - **Width:** `1920`
   - **Height:** `1080`
5. Enable:
   - `Shutdown source when not visible`
   - `Refresh browser when scene becomes active`
   - `Control audio via OBS` (optional, for separate mixer control)

### Available Overlay Themes

- `gold` (Default) — Royal metallic gold border and amber ambient glow
- `cyber-blue` — Neon cyan futuristic sci-fi aesthetic
- `crimson` — High-intensity competitive ruby glow
- `violet` — Sleek deep purple synthwave palette
- `emerald` — Clean vibrant neon green gamer frame
- `rose` — Soft rose-gold luxury stream alert

Themes can be previewed or overridden via the URL query parameter `?theme=cyber-blue` or configured in the Creator Dashboard OBS Setup Modal.

---

## 5. Razorpay Payment & Webhook Configuration

### Checkout & Order Creation
Payments use a two-step server-authoritative flow:
1. `POST /api/payments/create-order`: Validates interaction price, enforces creator minimum pricing, and creates a Razorpay order with bound metadata notes (`creator_id`, `interaction_type`).
2. `POST /api/payments/verify`: Validates checkout signature in constant time, independently verifies captured status from the Razorpay API, and issues a short-lived HMAC payment verification token.
3. `POST /api/interactions`: Atomic submission insertion requiring valid payment verification token.

### Webhook Endpoint Setup
1. In your Razorpay Dashboard, navigate to **Settings -> Webhooks**.
2. Add a new webhook URL:
   ```
   https://<your-domain>/api/payments/webhook
   ```
3. Set **Secret** to your `RAZORPAY_WEBHOOK_SECRET`.
4. Select active events:
   - `payment.captured`
   - `order.paid`
5. Test endpoint health:
   ```bash
   curl -X GET https://<your-domain>/api/payments/webhook
   ```
   Returns `{"status": "healthy"}` when configured.

---

## 6. Testing & Quality Verification

Run the test suites:

```bash
# Run all unit and lifecycle integration tests
npm.cmd test

# Type checking
npx.cmd tsc --noEmit

# Production build
npx.cmd next build
```

### Test Suites Included
- **Overlay Lifecycle & Security:** HMAC event token generation, tamper resistance, replay prevention, and atomic claim locks.
- **Payment Lifecycle & Verification:** Signature forgery rejection, captured payment verification, price boundary enforcement, and duplicate payment replay prevention.
- **Interactions Lifecycle:** Viewer soundboard listing isolation, creator sound selection, cross-creator protection, and state machine transitions.
- **Earnings Utilities:** 15-day rolling payout cycle boundaries, platform fee (10%) calculations, daily chart aggregations, and CSV exports.

---

## 7. Production Deployment Checklist

- [ ] Set `NEXT_PUBLIC_APP_URL` to your production domain (HTTPS).
- [ ] Ensure `RAZORPAY_KEY_ID` and `RAZORPAY_KEY_SECRET` use live credentials in production.
- [ ] Configure `RAZORPAY_WEBHOOK_SECRET` in both production environment and Razorpay Dashboard.
- [ ] Run SQL migrations from `docs/sql/` in your Supabase database.
- [ ] Ensure Supabase Storage bucket `soundboard-audio` exists and is private.
- [ ] Configure Google OAuth authorized redirect URI in Google Cloud Console.
- [ ] Verify `npm.cmd test` and `npx.cmd next build` pass before release.
