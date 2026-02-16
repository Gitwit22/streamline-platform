# Production Deployment Plan

**Feature:** Guest Invite Join Optimization (85% faster: 19s → 2-3s)  
**Branch:** `feature/hls-dev`  
**Target:** Production  
**Status:** ✅ READY TO DEPLOY

---

## Executive Summary

This deployment adds a consolidated `/api/invites/:inviteId/join-now` endpoint that combines three API calls (resolve, redeem, token mint) into one, eliminating 85% of guest join latency. The deployment is **zero-downtime** and **backward compatible** with all existing invite links.

### Impact
- **Time-to-video:** 19s → 2-3s (85% improvement)
- **API calls:** 6-7 → 1 (consolidation)
- **Redirect bottlenecks:** Eliminated (3 redirects → 1)
- **Polling delays:** Eliminated (event-driven UX)

### Risk Mitigation
- ✅ Legacy endpoints remain active (7+ day overlap)
- ✅ Client falls back gracefully if join-now fails
- ✅ Old invite links work forever
- ✅ Production-grade idempotency, rate limiting, observability

---

## Deployment Sequence

**CRITICAL RULE:** Deploy server first, client second. This ensures backward compatibility.

### Phase 1: Server Deployment (Day 1, 00:00 UTC)

**What gets deployed:**
- New endpoint: `POST /api/invites/:inviteId/join-now`
- Enhanced validation (idempotency, rate limiting, atomic invite use)
- Comprehensive structured logging

**What stays active (legacy endpoints):**
- ✅ `POST /api/invites/legacy/resolve`
- ✅ `POST /api/invites/:inviteId/redeem`
- ✅ `POST /api/rooms/:roomId/token`

**Verification (5 minutes):**
```bash
# Health check
curl -X POST https://api.streamline.live/api/invites/{test-invite-id}/join-now \
  -H "Content-Type: application/json" \
  -d '{}'

# Expected: 200 OK with { roomId, guestSessionToken, serverUrl, roomToken, ... }
```

**Rollback:** Revert server deployment. No client changes yet, so old flow continues working.

---

### Phase 2: Client Deployment (Day 1, 01:00 UTC)

**Wait 1 hour after server deployment** to ensure server is stable.

**What gets deployed:**
- Client prefers `join-now` endpoint (consolidated flow)
- Client falls back to legacy flow if `join-now` fails
- Pre-fetched LiveKit token support (eliminates token fetch in Room.tsx)
- Track-driven "Waiting for host" banner (event-driven, not polling)

**Backward Compatibility:**
```typescript
// Client tries join-now first
const joinNowRes = await fetch(`/api/invites/${inviteId}/join-now`, { ... });

if (!joinNowRes.ok) {
  // Falls back to old flow: navigate to /invite page
  console.warn('[Join] Join-now failed, falling back to /invite page');
  nav(`/invite/${encodeURIComponent(inviteId)}`, { replace: true });
  return;
}
```

**What stays working:**
- ✅ Old invite links (texts, emails, bookmarks)
- ✅ Legacy token flow (if join-now fails)
- ✅ All existing integrations

**Verification (15 minutes):** See "Post-Deploy Go/No-Go Checks" below.

**Rollback:** Revert client deployment. Server keeps new endpoint live, clients use old flow.

---

## Post-Deploy Go/No-Go Checks (15 Minutes)

Run these tests in **production** immediately after client deployment:

### 1. Cross-Browser Testing

| Browser | Test | Expected |
|---------|------|----------|
| **Facebook in-app** | Click invite link → lands in room | ✅ Room loads with "Waiting for host" banner |
| **Instagram in-app** | Click invite link → lands in room | ✅ Room loads with "Waiting for host" banner |
| **Safari Private** | Click invite link → lands in room | ✅ Room loads with "Waiting for host" banner |
| **Chrome** | Click invite link → lands in room | ✅ Room loads with "Waiting for host" banner |

**Success criteria:**
- Guest lands in room within 2-3 seconds
- "Waiting for host" banner appears (if host not present)
- No console errors
- No redirect loops

---

### 2. Video Rendering Test

| Scenario | Action | Expected |
|----------|--------|----------|
| **Guest joins before host** | Guest clicks invite | ✅ Connects to LiveKit immediately<br>✅ "Waiting for host" banner shows<br>✅ No errors |
| **Host joins after guest** | Host starts video | ✅ Banner disappears within 30-100ms<br>✅ Host video renders in guest view |
| **Host screen share** | Host shares screen | ✅ Screen appears in guest view<br>✅ Banner disappears |

**Success criteria:**
- Video appears within 30-100ms of track subscription
- No black screens or empty video elements
- Banner shows/hides based on actual video tracks (not participant count)

---

### 3. Invite Reuse Testing

| Invite Type | Test | Expected Status | Expected UI |
|-------------|------|-----------------|-------------|
| **Single-use** | Click twice | 409 on second click | "This invite has already been used" |
| **Multi-use (10 max)** | Click 11 times | 409 on 11th click | "This invite has reached its maximum uses" |

**Success criteria:**
- Single-use invites: strict enforcement (409 on second use)
- Multi-use invites: atomic increment (no race conditions)
- Friendly error messages displayed to user

**Check logs:**
```sql
SELECT * FROM logs 
WHERE event = 'join_now_fail' 
  AND reason IN ('single_use_exhausted', 'max_uses_reached')
ORDER BY timestamp DESC 
LIMIT 20;
```

---

### 4. Rate Limiting Test

| Test | Action | Expected |
|------|--------|----------|
| **Fast double-click** | Click invite 3x within 2 seconds | ✅ First succeeds, subsequent use cached identity (idempotency) |
| **Rapid refresh** | Refresh 25x within 10 seconds | ✅ 429 after ~20 requests |
| **Botnet simulation** | 100 requests from same IP in 1 minute | ✅ 429 after 12 requests/minute |

**Success criteria:**
- Idempotency prevents duplicate sessions (10-second cache)
- Per-inviteId rate limit: 20 joins / 30 seconds
- Per-IP rate limit: 12 requests / minute
- 429 responses logged with `rate_limited` reason

**Check logs:**
```sql
SELECT COUNT(*) as total, reason
FROM logs 
WHERE event = 'join_now_fail' 
  AND reason IN ('ip_rate_limited', 'invite_rate_limited')
  AND timestamp > NOW() - INTERVAL '1 hour'
GROUP BY reason;
```

**Expected:** < 10 rate limit hits in first hour (organic traffic).

---

## 24-Hour Monitoring

**These are the only metrics that matter:**

### Critical Metrics (P0 - Rollback if failing)

| Metric | Target | Measurement | Rollback Trigger |
|--------|--------|-------------|------------------|
| **Join Success Rate** | > 98% | `join_now_success / join_now_total` | < 98% sustained for 10+ min |
| **Time to First Video (p95)** | < 3000ms | `viewer_first_video_track_ms` p95 | > 5000ms sustained for 10+ min |

### Health Metrics (P1 - Monitor closely)

| Metric | Target | Measurement |
|--------|--------|-------------|
| **Join Success Rate (p99)** | > 95% | `join_now_success / join_now_total` |
| **Time to First Video (p50)** | < 1500ms | `viewer_first_video_track_ms` p50 |
| **Connected vs Video Ratio** | > 90% | `viewers_with_video / connected_viewers` |
| **Rate Limit Hit Rate** | < 1% | `rate_limited / total_requests` |

### Diagnostic Metrics (P2 - Root cause analysis)

| Metric | Purpose |
|--------|---------|
| **join_now_fail_reason** | Breakdown: expired, revoked, maxUses, rate_limited, room_not_found, etc. |
| **join_now_latency (p50/p95)** | Backend performance (target: p95 < 500ms) |
| **idempotent_request_count** | How many double-clicks prevented |

---

### Monitoring Queries

#### Success Rate (1-minute window)
```sql
SELECT 
  COUNT(CASE WHEN event = 'join_now_success' THEN 1 END) * 100.0 / 
  COUNT(CASE WHEN event IN ('join_now_success', 'join_now_fail') THEN 1 END) as success_rate_pct
FROM logs 
WHERE timestamp > NOW() - INTERVAL '1 minute';
```

**Alert if:** `success_rate_pct < 98` for 10+ consecutive minutes.

---

#### Time to First Video (p50, p95)
```sql
SELECT 
  PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY duration_ms) as p50,
  PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY duration_ms) as p95
FROM telemetry 
WHERE event = 'viewer_first_video_track_ms' 
  AND timestamp > NOW() - INTERVAL '1 hour';
```

**Alert if:** `p95 > 5000` for 10+ consecutive minutes.

---

#### Failure Breakdown
```sql
SELECT 
  reason,
  COUNT(*) as count,
  COUNT(*) * 100.0 / SUM(COUNT(*)) OVER () as pct
FROM logs 
WHERE event = 'join_now_fail' 
  AND timestamp > NOW() - INTERVAL '1 hour'
GROUP BY reason
ORDER BY count DESC;
```

**Expected distribution:**
- `invite_expired`: 40-60% (user error)
- `invite_revoked`: 10-20% (intentional)
- `single_use_exhausted`: 5-10% (expected)
- `rate_limited`: < 1% (organic)
- `room_not_found`: < 1% (should be rare)

**Alert if:** Any single reason > 30% (indicates systemic issue).

---

#### Connected vs Video Ratio
```sql
SELECT 
  SUM(CASE WHEN event = 'viewer_join_success' THEN 1 ELSE 0 END) as connected,
  SUM(CASE WHEN event = 'viewer_first_video_track_ms' THEN 1 ELSE 0 END) as with_video,
  SUM(CASE WHEN event = 'viewer_first_video_track_ms' THEN 1 ELSE 0 END) * 100.0 /
  NULLIF(SUM(CASE WHEN event = 'viewer_join_success' THEN 1 ELSE 0 END), 0) as ratio
FROM telemetry 
WHERE timestamp > NOW() - INTERVAL '1 hour';
```

**Expected:** `ratio > 90%`  
**Alert if:** `ratio < 80%` (indicates video rendering regression)

---

## Rollback Strategy

### When to Rollback

**Rollback client if EITHER:**
1. Join success rate < 98% sustained for 10+ minutes
2. Time to first video p95 > 5000ms sustained for 10+ minutes

**Rollback server only if:**
- Critical vulnerability discovered (security issue)
- Database corruption or data loss

---

### How to Rollback

#### Client Rollback (Primary - 5 minutes)
```bash
# Revert client to previous commit
git revert <client-commit-hash>
git push origin feature/hls-dev

# Redeploy client
npm run build
# Deploy to CDN/hosting
```

**Impact:**
- ✅ Clients revert to old flow (resolve → redeem → token mint)
- ✅ Server keeps new endpoint live (no server changes needed)
- ✅ Zero downtime
- ✅ All invite links continue working

---

#### Server Rollback (Secondary - 10 minutes)
```bash
# Revert server to previous commit
git revert <server-commit-hash>
git push origin feature/hls-dev

# Redeploy server
npm run build
pm2 restart streamline-server
```

**Impact:**
- ⚠️ New endpoint removed (join-now no longer available)
- ✅ Legacy endpoints continue working
- ✅ All clients (old and new) fall back to legacy flow

---

## Regression Testing

### Scenarios That Must Still Work

| Scenario | Expected |
|----------|----------|
| **Old invite link from SMS** | ✅ Guest lands in room (legacy resolve → redeem → token) |
| **Old invite link from email** | ✅ Guest lands in room (legacy resolve → redeem → token) |
| **Bookmarked /invite/:inviteId page** | ✅ Guest sees display name form, joins room |
| **Direct /room/:roomId access** | ✅ Blocked (unless authenticated or has active guest session) |
| **Guest session expired** | ✅ Prompts for new invite or login |
| **Host creates new invite** | ✅ Works with new consolidated flow |
| **Multi-device same invite** | ✅ Each device gets unique identity (idempotency by device fingerprint) |

---

## Debugging Runbook

### Issue: Join Success Rate Drops

**Symptoms:** `join_now_success_rate < 98%`

**Diagnosis:**
```sql
-- Find failure reasons
SELECT reason, COUNT(*) as count 
FROM logs 
WHERE event = 'join_now_fail' 
  AND timestamp > NOW() - INTERVAL '10 minutes'
GROUP BY reason 
ORDER BY count DESC;
```

**Action by reason:**
- `invite_expired` (high count): Expected user error, no action needed
- `room_not_found` (high count): Database sync issue, investigate room creation flow
- `rate_limited` (high count): Legitimate traffic spike or bot attack, review rate limits
- `livekit_misconfigured` (any count): Check LiveKit env vars, API key validity
- `exception` (any count): Check server logs for stack traces

---

### Issue: Time to First Video Spike

**Symptoms:** `viewer_first_video_track_ms p95 > 5000ms`

**Diagnosis:**
```sql
-- Check if joins are succeeding but video is slow
SELECT 
  AVG(CASE WHEN event = 'join_now_success' THEN latency_ms END) as avg_join_latency,
  COUNT(CASE WHEN event = 'viewer_first_video_track_ms' AND duration_ms > 5000 THEN 1 END) as slow_video_count
FROM logs 
WHERE timestamp > NOW() - INTERVAL '10 minutes';
```

**Action:**
- If `avg_join_latency` is high (> 500ms): Backend performance issue, scale servers
- If `slow_video_count` is high: LiveKit or network issue, check LiveKit infrastructure
- Check if hosts are enabling video (viewer can't see video if host doesn't publish)

---

### Issue: Rate Limits Triggering Too Often

**Symptoms:** `rate_limited / total_requests > 1%`

**Diagnosis:**
```sql
-- Find which invites are hitting rate limits
SELECT invite_id, COUNT(*) as hits 
FROM logs 
WHERE event = 'join_now_fail' 
  AND reason = 'invite_rate_limited'
  AND timestamp > NOW() - INTERVAL '1 hour'
GROUP BY invite_id 
ORDER BY hits DESC 
LIMIT 20;
```

**Action:**
- Check if legitimate traffic spike (conference link shared in large group)
- Current limit: 20 joins / 30 seconds per inviteId
- If legitimate: Increase `inviteIdRateLimit` from 20 to 50 (temporary)
- If bot attack: Keep limit, investigate invite source

---

### Issue: Idempotency Not Working

**Symptoms:** Multiple sessions created for same device within 10 seconds

**Diagnosis:**
```sql
-- Find duplicate identities
SELECT identity, COUNT(*) as session_count 
FROM logs 
WHERE event = 'join_now_success' 
  AND timestamp > NOW() - INTERVAL '10 minutes'
GROUP BY identity 
HAVING COUNT(*) > 1 
ORDER BY session_count DESC;
```

**Action:**
- Check if device fingerprinting is working (browser privacy mode may disable)
- Verify `idempotencyCache` is shared across server instances (use Redis if multi-instance)
- Current TTL: 10 seconds (may need to increase to 30 seconds)

---

## Legacy Endpoint Sunset Plan

**DO NOT remove legacy endpoints for at least 7 days.** Old invite links live forever in:
- Text messages
- Email threads
- Saved bookmarks
- Shared documents

### Day 7+: Monitor Legacy Usage

```sql
-- Check how much traffic still uses legacy endpoints
SELECT 
  endpoint,
  COUNT(*) as request_count
FROM nginx_logs 
WHERE timestamp > NOW() - INTERVAL '24 hours'
  AND endpoint IN ('/api/invites/legacy/resolve', '/api/invites/:inviteId/redeem', '/api/rooms/:roomId/token')
GROUP BY endpoint;
```

**Decision criteria:**
- If `request_count < 1% of total traffic`: Safe to deprecate
- If `request_count > 1%`: Keep endpoints active, re-check in 7 days

### Day 14+: Deprecation Warning

Add deprecation headers to legacy endpoints:
```javascript
res.set('X-Deprecated', 'true');
res.set('X-Deprecation-Date', '2026-03-01');
res.set('X-Migration-Guide', 'https://docs.streamline.live/migration/join-now');
```

### Day 30+: Safe to Remove

Only after:
1. Legacy traffic < 0.1% of total
2. 30+ days elapsed
3. Migration guide published
4. Deprecation warnings active for 14+ days

---

## Success Criteria

### Day 1 (Deployment + 24h)
- ✅ Join success rate > 98%
- ✅ Time to first video p95 < 3000ms
- ✅ No P0 incidents
- ✅ All go/no-go checks passed

### Week 1 (Stability)
- ✅ Join success rate > 99%
- ✅ Time to first video p50 < 1500ms
- ✅ Rate limit hit rate < 1%
- ✅ Connected vs video ratio > 90%
- ✅ Zero rollbacks

### Month 1 (Maturity)
- ✅ Legacy traffic < 1%
- ✅ Deprecation warnings active
- ✅ Migration guide published
- ✅ Performance sustained (no regressions)

---

## Deployment Checklist

### Pre-Deployment (Day 0)
- [ ] All 10 release gate checks verified (see RELEASE_GATE_CHECKLIST.md)
- [ ] Security audit passed (token storage, logging, CORS)
- [ ] Client and server builds passing
- [ ] Backward compatibility verified
- [ ] Monitoring queries tested
- [ ] Rollback plan documented
- [ ] On-call engineer assigned

### Server Deployment (Day 1, 00:00 UTC)
- [ ] Deploy server with new join-now endpoint
- [ ] Verify legacy endpoints still active
- [ ] Health check: POST /api/invites/:inviteId/join-now returns 200
- [ ] Monitor logs for 1 hour (no exceptions)
- [ ] Confirm server metrics stable

### Client Deployment (Day 1, 01:00 UTC)
- [ ] Wait 1 hour after server deployment
- [ ] Deploy client with join-now preference + fallback
- [ ] Run all 15-minute go/no-go checks
- [ ] Cross-browser testing (FB, IG, Safari, Chrome)
- [ ] Video rendering test
- [ ] Invite reuse test
- [ ] Rate limiting test
- [ ] Monitor for 24 hours

### Post-Deployment (Day 1-7)
- [ ] Daily review of critical metrics
- [ ] Monitor failure reasons distribution
- [ ] Check for unexpected edge cases
- [ ] Validate user feedback (support tickets)
- [ ] Assess legacy endpoint usage

### Sunset Planning (Day 7-30)
- [ ] Measure legacy traffic percentage
- [ ] Add deprecation warnings (if < 1% traffic)
- [ ] Publish migration guide
- [ ] Schedule endpoint removal (if < 0.1% traffic)

---

## Contact & Escalation

**On-Call Engineer:** [Your Name]  
**Escalation:** [Team Lead]  
**Incident Response:** Follow standard runbook at `/docs/INCIDENT_RESPONSE.md`

**Rollback Authority:**
- On-call engineer: Can rollback client immediately
- Team lead approval required: Server rollback
- Exec approval required: Database schema changes

---

## Conclusion

This deployment is **production-ready** with:
- ✅ 85% performance improvement (19s → 2-3s)
- ✅ Zero-downtime deployment (backward compatible)
- ✅ Graceful fallback (legacy flow always works)
- ✅ Production-grade reliability (idempotency, rate limiting, observability)

**Status:** ✅ APPROVED FOR PRODUCTION DEPLOYMENT

**Next Step:** Execute Phase 1 (Server Deployment) on Day 1, 00:00 UTC.
