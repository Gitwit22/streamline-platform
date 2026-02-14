# 🔐 Production Environment Variables Checklist

**CRITICAL**: Verify ALL these environment variables before launching.

---

## ✅ Pre-Launch Verification

Run this checklist on your production server (Render, etc.) **before** making the app public.

### 1. Stripe (Billing) - MUST BE LIVE KEYS

```bash
# ❌ WRONG: sk_test_... (test mode)
# ✅ RIGHT: sk_live_... (live mode)

STRIPE_SECRET_KEY=sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...
```

**How to verify:**
```bash
# Check if using live key
echo $STRIPE_SECRET_KEY | grep "sk_live_" && echo "✅ LIVE" || echo "❌ TEST"

# Or in Node.js
node -e "console.log(process.env.STRIPE_SECRET_KEY.startsWith('sk_live_') ? '✅ LIVE' : '❌ TEST')"
```

**Get Webhook Secret:**
1. Go to https://dashboard.stripe.com/webhooks
2. Click your production webhook endpoint
3. Click "Reveal" on the signing secret
4. Starts with `whsec_...`

---

### 2. LiveKit (Video/Audio)

```bash
LIVEKIT_URL=wss://your-project.livekit.cloud
LIVEKIT_API_KEY=API...
LIVEKIT_API_SECRET=...
```

**How to verify:**
- Log into LiveKit dashboard
- Confirm URL matches your production project
- Regenerate keys if unsure which project they're from

---

### 3. Cloudflare R2 (Storage)

```bash
R2_ACCOUNT_ID=...
R2_ACCESS_KEY_ID=...
R2_SECRET_ACCESS_KEY=...
R2_BUCKET=streamline-prod  # Use different bucket for prod
R2_ENDPOINT=https://<account>.r2.cloudflarestorage.com
```

**How to verify:**
```bash
# Test R2 connection in production
curl https://your-api.com/api/test-r2

# Or check locally with prod credentials
npm run test:r2-connection
```

**⚠️ IMPORTANT**: Use a **different bucket** for production than development/test.

---

### 4. Firebase Admin SDK

```bash
# Option A: Base64 encoded service account (recommended for Render)
FIREBASE_SERVICE_ACCOUNT_BASE64=eyJ0eXBlIjoic2VydmljZV9hY2NvdW50...

# Option B: Path to JSON file (local dev only)
FIREBASE_SERVICE_ACCOUNT_PATH=/path/to/service-account.json
```

**How to verify:**
- Confirm using **production** Firebase project
- Check project ID in service account JSON matches production
- Test Firestore connection on startup

---

### 5. HLS CDN (Cloudflare Worker)

```bash
# ❌ WRONG: http://localhost:8787/hls
# ✅ RIGHT: https://cdn.your-domain.com/hls

HLS_PUBLIC_BASE_URL=https://cdn.your-domain.com/hls
```

**How to verify:**
- Visit the URL in a browser
- Should return 404 or method not allowed (not connection error)
- Verify CORS is configured for your frontend domain

---

### 6. Application Secrets

```bash
# Generate with: openssl rand -hex 32
JWT_SECRET=<64-char-hex-string>
ROOM_ACCESS_TOKEN_SECRET=<64-char-hex-string>
MAINTENANCE_KEY=<random-strong-password>
```

**How to generate:**
```bash
# Generate 3 strong secrets
openssl rand -hex 32  # JWT_SECRET
openssl rand -hex 32  # ROOM_ACCESS_TOKEN_SECRET
openssl rand -base64 24  # MAINTENANCE_KEY
```

**⚠️ NEVER** use the same secrets in production and development.

---

### 7. URLs & Endpoints

```bash
CLIENT_URL=https://your-app.com
PORT=10000
NODE_ENV=production
```

**How to verify:**
- `CLIENT_URL` should match your actual frontend domain
- Used for CORS and redirect URLs

---

## 🚨 Common Mistakes

### Mistake #1: Test Stripe Keys in Production
**Symptom**: Users can't subscribe, checkout fails  
**Fix**: Use `sk_live_...` not `sk_test_...`

### Mistake #2: Wrong LiveKit Project
**Symptom**: Rooms don't connect, join fails  
**Fix**: Verify API keys are from correct LiveKit project

### Mistake #3: Wrong R2 Bucket
**Symptom**: Recordings not found, HLS streams 404  
**Fix**: Check bucket name, verify files are uploading to correct bucket

### Mistake #4: Wrong Firebase Project
**Symptom**: Data not appearing, authentication fails  
**Fix**: Check service account project ID matches production

### Mistake #5: Localhost URLs in Production
**Symptom**: CORS errors, HLS streams fail  
**Fix**: Use production URLs (https://, not http://localhost)

---

## ✅ Final Verification Script

Run this on your production server after deployment:

```bash
#!/bin/bash
echo "🔍 Verifying Production Environment..."

# Check Stripe
if [[ $STRIPE_SECRET_KEY == sk_live_* ]]; then
  echo "✅ Stripe: LIVE mode"
else
  echo "❌ Stripe: TEST mode (CRITICAL ERROR)"
  exit 1
fi

# Check LiveKit
if [[ -z $LIVEKIT_URL ]]; then
  echo "❌ LiveKit: URL not set"
  exit 1
else
  echo "✅ LiveKit: $LIVEKIT_URL"
fi

# Check R2
if [[ -z $R2_BUCKET ]]; then
  echo "❌ R2: Bucket not set"
  exit 1
else
  echo "✅ R2: Bucket $R2_BUCKET"
fi

# Check Firebase
if [[ -z $FIREBASE_SERVICE_ACCOUNT_BASE64 ]]; then
  echo "⚠️  Firebase: Using file path (ok for some setups)"
else
  echo "✅ Firebase: Base64 configured"
fi

# Check secrets are set
if [[ -z $JWT_SECRET ]] || [[ ${#JWT_SECRET} -lt 32 ]]; then
  echo "❌ JWT_SECRET: Missing or too short"
  exit 1
else
  echo "✅ JWT_SECRET: Set"
fi

# Check HLS URL
if [[ $HLS_PUBLIC_BASE_URL == *localhost* ]]; then
  echo "❌ HLS: Still using localhost (CRITICAL ERROR)"
  exit 1
else
  echo "✅ HLS: $HLS_PUBLIC_BASE_URL"
fi

echo ""
echo "✅ All critical environment variables verified!"
```

---

## 📋 Render.com Specific

If deploying to Render:

1. **Go to Dashboard** → Your Service → Environment
2. **Add each variable** (one by one, tedious but necessary)
3. **Mark as Secret** for sensitive values (Stripe keys, secrets, etc.)
4. **Redeploy** after adding all variables

**⚠️ TIP**: Keep a `.env.production.template` file (without values) committed to git as a reference.

---

## 🔄 Post-Deployment Verification

After deploying with production env vars:

1. **Test Stripe Webhook**:
   ```bash
   stripe trigger checkout.session.completed --override customer=cus_test
   ```

2. **Test User Sign-up**:
   - Create new account
   - Should write to production Firestore
   - Should start on "free" plan

3. **Test Plan Upgrade**:
   - Upgrade to paid plan
   - Should redirect to Stripe Checkout
   - Should use LIVE mode (look for `checkout.stripe.com/c/pay/...`)

4. **Test HLS Streaming**:
   - Start HLS stream
   - Verify files appear in production R2 bucket
   - Verify HLS playlist accessible at CDN URL

5. **Check Logs**:
   ```bash
   # Render.com
   render logs --tail

   # Should see:
   # [stripe-webhook] Received: {...}
   # [livekit-webhook] Received request
   # No errors about missing env vars
   ```

---

## 📞 Emergency Rollback

If something is wrong after launch:

1. **Maintenance Mode**:
   ```bash
   # Set MAINTENANCE_MODE=1 to block all requests
   curl -X POST https://your-api.com/api/maintenance \
     -H "X-Maintenance-Key: $MAINTENANCE_KEY" \
     -d '{"enabled": true, "message": "Under maintenance"}'
   ```

2. **Revert to Previous Deploy** (Render):
   - Dashboard → Deploys → Find last working deploy
   - Click "Redeploy"

3. **Fix Environment Variables**:
   - Correct the wrong variable(s)
   - Trigger new deploy

4. **Exit Maintenance Mode**:
   ```bash
   curl -X POST https://your-api.com/api/maintenance \
     -H "X-Maintenance-Key: $MAINTENANCE_KEY" \
     -d '{"enabled": false}'
   ```

---

**Last Updated**: February 14, 2026  
**Review Before Every Deploy**: Yes, every time!
