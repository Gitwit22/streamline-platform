# 🚀 Pre-Launch Audit - StreamLine Platform

**Date**: February 14, 2026  
**Branch**: feature/hls-dev  
**Status**: ⚠️ NEEDS ATTENTION

---

## 1️⃣ Stripe Webhooks - ⚠️ CRITICAL GAPS IDENTIFIED

### ✅ Currently Handled Events

| Event | Signature Verified | Idempotent | Firestore Write | Notes |
|-------|-------------------|------------|-----------------|-------|
| `customer.subscription.created` | ✅ Yes | ✅ Yes | ✅ Correct | Uses `merge: true` |
| `customer.subscription.updated` | ✅ Yes | ✅ Yes | ✅ Correct | Uses `merge: true` |
| `customer.subscription.deleted` | ✅ Yes | ✅ Yes | ✅ Correct | Sets planId to "free" |
| `invoice.paid` | ✅ Yes | ✅ Yes | ✅ Correct | Retrieves subscription first |
| `invoice.payment_failed` | ✅ Yes | ✅ Yes | ✅ Correct | Sets planId to "free" |
| `checkout.session.completed` | ✅ Yes | ✅ Yes | ✅ Correct | Handles first subscription |

### ❌ MISSING CRITICAL HANDLERS

Your scheduled downgrade system uses Stripe `subscription_schedule` but you're **NOT** handling these webhook events:

```typescript
// ❌ NOT HANDLED - CRITICAL FOR SCHEDULED DOWNGRADES
subscription_schedule.updated
subscription_schedule.completed  // ← This fires when downgrade executes!
subscription_schedule.released
```

**PROBLEM**: When a scheduled downgrade executes (at period end), Stripe will:
1. Fire `subscription_schedule.completed` 
2. Update the subscription with the new price
3. Fire `customer.subscription.updated`

But if you only rely on `customer.subscription.updated`, you might miss the transition or get race conditions.

**RECOMMENDATION**: Add handler for `subscription_schedule.completed` to explicitly clear `scheduledPlanChange` when it executes.

### 🔍 Code Locations

- **Webhook Handler**: [webhook.ts:431-673](streamline-server/routes/webhook.ts)
- **Schedule Creation**: [billing.ts:630](streamline-server/routes/billing.ts)
- **Schedule Release**: [billing.ts:972](streamline-server/routes/billing.ts) (cancel endpoint)

### ⚠️ Potential Issues

1. **Ghost Pro Access**: If `subscription_schedule.completed` fails to fire or your webhook misses it:
   - User could stay on `pendingPlan` state indefinitely
   - `scheduledPlanChange` field never cleared
   - UI shows confusing state

2. **Double Writes**: Possible race between:
   - `subscription_schedule.completed` (schedule executes)
   - `customer.subscription.updated` (subscription changes)
   - Both could try to update same user doc

3. **Stuck Subscriptions**: If webhook processing fails:
   - User's Firestore state != Stripe state
   - Manual intervention required

### ✅ Good Patterns Already In Place

```typescript
// ✅ Signature verification
event = stripe.webhooks.constructEvent(
  req.body,
  String(sig),
  mustGetEnv("STRIPE_WEBHOOK_SECRET")
);

// ✅ Idempotent writes (merge: true)
await getUserRef(uid).set({ ... }, { merge: true });

// ✅ Plan change history tracking
const history = sanitizeHistory((user as any)?.planChangeHistory);
const nextHistory = [...history, { at: now, fromPlan: currentPlan, toPlan: canonicalPlan, source: "stripe_webhook" }].slice(-10);
```

### 📋 Action Items

- [ ] Add `subscription_schedule.completed` handler
- [ ] Add `subscription_schedule.released` handler (for cancel-plan-change)
- [ ] Test webhook replay (use Stripe CLI)
- [ ] Monitor webhook logs after launch
- [ ] Set up webhook retry alerts

---

## 2️⃣ Production Environment Variables - ⚠️ VERIFY BEFORE LAUNCH

### 🔑 Critical Variables (Must Be Production Values)

```bash
# ❌ DANGER: Make sure these are LIVE keys, not test mode
STRIPE_SECRET_KEY=sk_live_...  # NOT sk_test_
STRIPE_WEBHOOK_SECRET=whsec_...  # From production webhook endpoint

# LiveKit (verify project)
LIVEKIT_URL=wss://...
LIVEKIT_API_KEY=...
LIVEKIT_API_SECRET=...

# R2 Storage (verify bucket)
R2_ACCOUNT_ID=...
R2_ACCESS_KEY_ID=...
R2_SECRET_ACCESS_KEY=...
R2_BUCKET=...  # Production bucket
R2_ENDPOINT=https://<account>.r2.cloudflarestorage.com

# Firebase Admin
FIREBASE_SERVICE_ACCOUNT_BASE64=...  # Production project

# HLS CDN
HLS_PUBLIC_BASE_URL=https://cdn.your-domain.com/hls  # NOT localhost

# Auth & Secrets
JWT_SECRET=<strong-random-secret>
ROOM_ACCESS_TOKEN_SECRET=<strong-random-secret>
MAINTENANCE_KEY=<strong-random-secret>
```

### ⚠️ Common Pitfalls

1. **Stripe Test vs Live**: One test key in production = broken billing
2. **LiveKit Project**: Wrong project = rooms don't work
3. **R2 Bucket**: Wrong bucket = files not found
4. **Firebase Project**: Wrong project = wrong database

### 📋 Verification Script

```bash
# Make sure you're checking PRODUCTION environment
echo "Verifying production env vars..."
node -e "
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
console.log('Stripe mode:', process.env.STRIPE_SECRET_KEY.startsWith('sk_live_') ? 'LIVE ✅' : 'TEST ❌');
"
```

---

## 3️⃣ Usage Enforcement Under Stress - ✅ GOOD

### ✅ Concurrent Safety

Your usage tracking uses **Firestore transactions**, which provides atomic increments:

```typescript
// ✅ SAFE - Uses FieldValue.increment
await tx.update(monthRef, {
  totalMinutes: FieldValue.increment(minutes),
  hlsMinutes: FieldValue.increment(minutes),
  updatedAt: FieldValue.serverTimestamp()
});
```

**Why This Works**: 
- `FieldValue.increment()` is atomic at the database level
- 50 simultaneous requests will all correctly increment
- No lost updates or race conditions

### ✅ Error Code Consistency

All fixed! Using centralized constants:
- `LIMIT_ERRORS.FEATURE_DISABLED`
- `LIMIT_ERRORS.LIMIT_EXCEEDED`
- `PERMISSION_ERRORS.UNAUTHORIZED`
- `PERMISSION_ERRORS.ROOM_NOT_FOUND`

### 🧪 Stress Test Scenarios

**Scenario 1: 50 concurrent HLS starts**
- ✅ Each increments `usageMonthly.hlsMinutes`
- ✅ Transaction ensures no lost updates
- ✅ Limit check happens before egress starts

**Scenario 2: User at 99% of limit, 2 requests arrive simultaneously**
- ⚠️ Both might pass the limit check before increment
- Second request could push user 1-2 minutes over limit
- **This is acceptable** - you log overage and bill it

**Scenario 3: Overage user disables overages mid-stream**
- ✅ Next usage check will block
- ✅ Current streams continue (already started)

### 📋 Action Items

- [ ] Load test with 50 concurrent users
- [ ] Monitor `usageMonthly` writes during test
- [ ] Verify enforcement blocks cleanly at limit
- [ ] Check UI shows correct error messages

---

## 4️⃣ Logging + Visibility - ⚠️ NEEDS IMPROVEMENT

### ✅ Current Logging (Good Coverage)

**Webhook Events**:
```typescript
console.log("[stripe] Billing written from checkout.session.completed", { uid, planId, billingStatus });
console.error("[stripe] Webhook signature error:", err?.message);
console.error("[stripe] Webhook handler failed:", err?.message);
```

**LiveKit Webhooks**:
```typescript
console.log("[livekit-webhook] Received request");
console.log("[livekit-webhook] Recording ${recordingId} updated: ${currentStatus} → ${finalStatus}");
console.error("[livekit-webhook] CRITICAL: Missing egressId in egress_ended event");
```

### ❌ MISSING CRITICAL LOGS

**What You Need**:

1. **Webhook Event Details** (before processing):
```typescript
console.log("[stripe-webhook] Received:", {
  eventType: event.type,
  eventId: event.id,
  userId: sub?.metadata?.userId,
  subscriptionId: subscription.id,
  timestamp: new Date().toISOString()
});
```

2. **Plan Change Operations**:
```typescript
console.log("[billing] Plan change:", { 
  uid, 
  from: currentPlan, 
  to: targetPlan, 
  mode: "immediate|downgrade_scheduled",
  requestId 
});
```

3. **Usage Enforcement Decisions**:
```typescript
console.log("[usage] Limit check:", { 
  uid, 
  feature: "hls", 
  current: currentUsage, 
  limit: maxLimit, 
  allowed: true|false 
});
```

4. **Invite Resolution**:
```typescript
console.log("[invite] Resolved:", { 
  inviteId, 
  roomId, 
  role, 
  guestSession: true|false 
});
```

### 📊 Recommended Logging Structure

```typescript
// Standardize log format
function logEvent(category: string, action: string, data: any) {
  console.log(JSON.stringify({
    timestamp: new Date().toISOString(),
    category,
    action,
    ...data
  }));
}

// Usage:
logEvent("billing", "plan_change_scheduled", { uid, plan, effectiveAt });
logEvent("webhook", "stripe_received", { eventType, eventId, userId });
logEvent("usage", "limit_exceeded", { uid, feature, current, limit });
```

### 📋 Action Items

- [ ] Add structured logging to webhook handlers
- [ ] Log all billing operations with requestId
- [ ] Add usage enforcement decision logs
- [ ] Set up log aggregation (if not already)
- [ ] Create dashboard for key metrics

### 🔍 60-Second Diagnosis Test

**Can you answer these in 60 seconds?**
- [ ] Did user XYZ's webhook process successfully?
- [ ] Why did user ABC get billed twice?
- [ ] Which users hit their limit today?
- [ ] Did invite link 123 resolve correctly?

If not → improve logging.

---

## 5️⃣ Database Backup - ❌ CRITICAL - SET UP NOW

### 🚨 Before Real Billing Starts

**YOU MUST**:
1. Enable Firestore automatic backups
2. Test restore procedure
3. Document recovery process

### 📋 Firestore Backup Setup

#### Option A: Automatic Daily Backups (Recommended)

```bash
# Enable automatic backups via Firebase Console
# 1. Go to Firebase Console → Firestore Database
# 2. Click "Backups" tab
# 3. Enable automatic backups
# 4. Set schedule: Daily at 2 AM (low traffic time)
# 5. Set retention: 7 days minimum
```

#### Option B: Manual Export (Before Launch)

```bash
# Using gcloud CLI
gcloud firestore export gs://YOUR_BACKUP_BUCKET/pre-launch-backup

# Verify export
gsutil ls gs://YOUR_BACKUP_BUCKET/pre-launch-backup/
```

#### Option C: CI/CD Scheduled Backups

```yaml
# Add to your CI/CD (GitHub Actions, etc.)
- name: Daily Firestore Backup
  schedule:
    cron: '0 2 * * *'  # 2 AM daily
  run: |
    gcloud firestore export gs://YOUR_BACKUP_BUCKET/$(date +%Y%m%d)
```

### 🧪 Test Restore Procedure

**BEFORE LAUNCH**:

1. **Create test backup**:
```bash
gcloud firestore export gs://YOUR_BACKUP_BUCKET/test-backup
```

2. **Restore to test project**:
```bash
# Create a separate Firebase project for testing
gcloud firestore import gs://YOUR_BACKUP_BUCKET/test-backup \
  --project=YOUR_TEST_PROJECT
```

3. **Verify data integrity**:
```bash
# Check user count matches
# Check billing data is intact
# Check room data is present
```

### 📋 Recovery Runbook

**If disaster strikes**:

1. **Stop all writes** (maintenance mode)
2. **Identify last good backup**
3. **Restore to staging first**
4. **Verify data integrity**
5. **Restore to production**
6. **Resume operations**

**Time estimate**: 2-4 hours (if you've practiced)

### 📋 Action Items

- [ ] Enable automatic Firestore backups (7 day retention minimum)
- [ ] Export manual pre-launch snapshot
- [ ] Test restore to separate project
- [ ] Document recovery procedure
- [ ] Set calendar reminder: test restore monthly

---

## 📊 Bundle Size - ℹ️ Non-Blocking

**Current**: 1.8MB bundle (512KB gzipped)

**Assessment**: Fine for launch. Not a blocker.

**Post-Launch Optimization** (when you have revenue):

```typescript
// Lazy load heavy components
const AdminDashboard = lazy(() => import('./pages/AdminDashboard'));
const BillingSettings = lazy(() => import('./pages/SettingsBilling'));
const HLSViewer = lazy(() => import('./components/HLSViewer'));

// Code split by route
const router = createBrowserRouter([
  { path: '/admin', element: <AdminDashboard />, lazy: true },
  { path: '/settings/billing', element: <BillingSettings />, lazy: true },
]);
```

**Potential Savings**: Could reduce to ~800KB bundle, ~300KB gzipped

---

## ✅ Pre-Launch Checklist

### 🚨 BLOCKERS (Must Fix)

- [ ] **Add Stripe `subscription_schedule.completed` webhook handler**
- [ ] **Enable Firestore automatic backups**
- [ ] **Test manual backup + restore**
- [ ] **Verify ALL production environment variables**

### ⚠️ HIGH PRIORITY (Should Fix)

- [ ] Verify Stripe webhook endpoint configured (see previous instructions)
- [ ] Add structured logging to webhook handlers
- [ ] Add billing operation logging
- [ ] Load test concurrent usage (50 users)

### ℹ️ RECOMMENDED (Can Wait)

- [ ] Set up log aggregation dashboard
- [ ] Monthly backup restore test
- [ ] Bundle optimization
- [ ] Performance monitoring setup

---

## 🎯 Launch Readiness Score

### Current: 70% Ready

| Category | Status | Score |
|----------|--------|-------|
| Core Tests | ✅ Passing | 17/17 |
| Code Quality | ✅ Clean | 100% |
| Webhooks | ⚠️ Gaps | 60% |
| Environment | ⚠️ Unverified | 50% |
| Usage Enforcement | ✅ Good | 90% |
| Logging | ⚠️ Basic | 60% |
| Backups | ❌ Not Set | 0% |

**After Fixes: 95% Ready** ✅

---

## 🚀 Next Steps

1. **TODAY** (2 hours):
   - Add subscription_schedule webhook handlers
   - Enable Firestore backups
   - Verify production env vars

2. **BEFORE LAUNCH** (4 hours):
   - Test backup restore
   - Load test concurrent usage
   - Configure Stripe webhook endpoint

3. **WEEK 1 POST-LAUNCH**:
   - Monitor webhook logs
   - Check for stuck subscriptions
   - Verify usage tracking accurate

---

**Generated**: February 14, 2026  
**Next Review**: After above items completed
