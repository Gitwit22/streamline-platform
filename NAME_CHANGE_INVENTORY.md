# Streamline Name Change Inventory

**Generated:** February 14, 2026  
**Purpose:** Complete inventory of all "Streamline" references to prepare for rebranding

> **⚡ TL;DR:** For branding purposes, you only need to change ~15 UI files, your domain, and one email address. The other 450+ references are internal code that users never see. See "THE ESSENTIALS" section below.

---

## 🎯 **THE ESSENTIALS** - What Actually Matters for Branding

If your goal is to avoid branding conflict or user confusion, focus ONLY on these public-facing assets. Everything else is internal housekeeping that can wait.

### ✅ Must-Change for Public Branding

| Category | Location | What to Change |
|----------|----------|----------------|
| **🌐 Website Domain** | DNS, Render config | `streamline.nxtlvlts.com` → `[newname].nxtlvlts.com` |
| **🏠 Landing Page Name** | `streamline-client/src/pages/Welcome.jsx` | Line 137: "Welcome to StreamLine" |
| **🎨 Logo/Brand Text** | Multiple UI files | "StreamLine Logo" alt text, watermarks |
| **📱 App Header/UI** | Throughout client pages | "StreamLine" in navigation, banners, buttons |
| **📧 Support Email** | `SettingsBilling.tsx` | `support@streamline.app` |
| **📄 Legal Pages** | `Terms.tsx`, `Privacy.tsx` | All "StreamLine" references (~20 instances) |
| **📱 HTML Title** | `streamline-client/index.html` | `<title>streamline-client</title>` |
| **💬 Marketing Copy** | `LearnMore.tsx`, `Join.tsx`, `PricingExplainerPage.tsx` | User-facing text |
| **🔗 OG/Meta Tags** | Check all page meta tags | Social sharing previews |

### 📍 Quick-Hit File List (Essentials Only)

```
streamline-client/index.html                        # HTML title
streamline-client/src/pages/Welcome.jsx             # Landing page
streamline-client/src/pages/Join.tsx                # Join flow branding
streamline-client/src/pages/LearnMore.tsx           # Marketing content
streamline-client/src/pages/Room.tsx                # In-room UI, watermarks
streamline-client/src/pages/Live.tsx                # Public viewer branding
streamline-client/src/pages/Terms.tsx               # Legal terms
streamline-client/src/pages/Privacy.tsx             # Privacy policy
streamline-client/src/pages/Support.tsx             # Support page
streamline-client/src/pages/LoginPage.tsx           # Login branding
streamline-client/src/pages/SignupPage.tsx          # Signup branding
streamline-client/src/pages/PricingExplainerPage.tsx # Pricing copy
streamline-client/src/pages/SettingsBilling.tsx     # Support email
streamline-client/src/pages/SettingsDestinations.tsx # Feature descriptions
streamline-client/src/components/UsageBanner.tsx    # UI labels
```

### ⚡ Essential-Only Change Process

1. **Pick your new name** 
2. **Update the ~15 UI files above** (find/replace "StreamLine" with careful review)
3. **Change domain** (update DNS + Render config)
4. **Update support email** (1 file: SettingsBilling.tsx)
5. **Test user-facing flows** (signup, login, join, legal pages)
6. **Deploy**

**Time estimate:** 2-4 hours for essentials only

Everything below this line is comprehensive technical inventory for when you want to do a complete rebrand internally...

---

## 📁 1. Directory & File Names

### Folders
- `streamline-client/` - Main client application folder
- `streamline-server/` - Main server application folder

### Files
No files directly named "streamline" (only folders)

---

## 📦 2. Package Names & Identifiers

### package.json Files
- **Root:** `package-lock.json` - `"name": "Streamline"`
- **Server:** `streamline-server/package.json` - `"name": "streamline-server"`
- **Client:** `streamline-client/package.json` - `"name": "streamline-client"`

### HTML Titles
- `streamline-client/index.html` - `<title>streamline-client</title>`

---

## 🌐 3. URLs & Domains

### Production URLs (in streamline-server/index.ts)
```
https://streamline-platform.onrender.com
https://streamline-hls-dev-web.onrender.com
https://streamline.nxtlvlts.com
https://www.streamline.nxtlvlts.com
```

### API Base URLs (in streamline-client/src/lib/apiBase.ts)
```
https://streamline-backend2test.onrender.com
```

### Support Email (in streamline-client/src/pages/SettingsBilling.tsx)
```
support@streamline.app
```

### Repository
- GitHub: `https://github.com/Gitwit22/streamline-platform`

---

## ⚙️ 4. Configuration Files

### render.yaml (Root)
- Service names: `streamline-backend2test`, `streamline-platform-test`, `streamline-expire-emergency-recordings`
- Repo references: `https://github.com/Gitwit22/streamline-platform`
- Root directories: `streamline-server`, `streamline-client`

### streamline-server/render.yaml
- Service names: `streamline-backend2`, `streamline-expire-emergency-recordings`
- Root directory: `streamline-server`

### Environment Variables
- `STREAMLINE_TOKEN` (in audit-plan-train.mjs)
- `R2_BUCKET_NAME=streamline-recordings` (in STORAGE_CLIENT_GUIDE.md)
- Firebase path: `streamline-server/firebaseServiceAccount.json`

---

## 💻 5. Code References

### Comments & Headers
- `streamline-server/middleware/requireAuth.ts` - "StreamLine uses custom auth UID..."
- `streamline-server/routes/recordings.ts` - "* StreamLine Recordings API"
- `streamline-server/routes/webhook.ts` - "* StreamLine Webhooks"
- `streamline-server/index.ts` - `service: "StreamLine Backend API"`
- Multiple file headers with "STREAMLINE" in uppercase

### Code Constants & Strings
- `streamline-server/index.ts` - Storage test content string
- `streamline-server/scripts/expireEmergencyCron.ts` - User-Agent: `streamline-cron/expire-emergency`
- `streamline-client/src/lib/api.ts` - Comment about "Streamline-scoped session state"

### Variable Names & File References
- File paths in imports and references (300+ instances)
- Examples: 
  - `../streamline-server/firebaseAdmin`
  - `streamline-client/src/lib/api.ts`
  - `from '../streamline-server/lib/limitErrors'`

---

## 📄 6. Documentation

### Document Titles & Headers
- `docs/CHECKLIST.md` - "✅ StreamLine Checklist (Current)"
- `docs/PERMISSIONS_AUDIT.md` - "# StreamLine Permissions Audit"
- `docs/PHASES_0-4_SUMMARY.md` - "# StreamLine Invite System - Phases 0-4 Complete"
- `docs/PHASES_0-6_COMPLETE.md` - "# StreamLine Invite System - Phases 0-6 Complete"
- `deployment/README.md` - "# StreamLine Editing Suite: Deployment & Ngrok Setup"
- `future state/README.md` - "This folder contains plan documents and future-facing specs for StreamLine."
- `future state/StreamLine_Room_Customization_HLS_Greenroom_Gating_PLAN.md`

### Technical Documentation
- Multiple `.md` files in `/docs/` folder (30+ files)
- Guide files: `EDITOR_GUIDE.md`, `DEVELOPMENT.md`, `STORAGE_CLIENT_GUIDE.md`
- Server/client path references throughout all documentation

---

## 🎨 7. User-Facing Content

### UI Text & Labels
- `streamline-client/src/components/UsageBanner.tsx` - "StreamLine Usage"
- `streamline-client/src/pages/Welcome.jsx` - "Welcome to StreamLine"
- `streamline-client/src/pages/Join.tsx` - Multiple "StreamLine Live", "StreamLine Logo" references
- `streamline-client/src/pages/LearnMore.tsx` - Extensive marketing copy (10+ instances)
- `streamline-client/src/pages/Room.tsx` - "Thank you for joining StreamLine", watermarks, logos
- `streamline-client/src/pages/Live.tsx` - "Powered by StreamLine"

### Legal Pages
- `streamline-client/src/pages/Terms.tsx` - Terms & Conditions (15+ instances)
- `streamline-client/src/pages/Privacy.tsx` - Privacy policy references
- `streamline-client/src/pages/Support.tsx` - Support page header
- `streamline-client/src/pages/SignupPage.tsx` - Account creation text

### Marketing/Info Pages
- `streamline-client/src/pages/PricingExplainerPage.tsx` - "How Minutes Work on StreamLine", etc.
- `streamline-client/src/pages/SettingsDestinations.tsx` - Feature descriptions
- `streamline-client/src/lib/usageLabels.ts` - "StreamLine rooms" in descriptions

### Page Titles & Meta
- `streamline-client/src/pages/Join.tsx` - Dynamic titles: `"StreamLine Live"`
- `streamline-client/src/pages/Live.tsx` - Fallback title: `"StreamLine"`

---

## 🔧 8. Scripts & Utilities

### Root Scripts
- `audit-plan-train.mjs` - "StreamLine Plan Train Audit"
- `setup-editing-plans.js` - "StreamLine Editing Plans Setup Script"

### Deployment Scripts
- `deployment/start-dev.ps1` - "Starting StreamLine backend..."
- `deployment/update-env-ngrok.ps1` - Path references
- `deployment/HLS_TESTING.md` - Testing documentation

### Validation Scripts
- `scripts/check-no-raw-api-fetch.ts` - Path and error message references
- `scripts/enforcement-drift-check.ts` - Import paths
- `scripts/enforcement-drift-check.sh` - Shell script paths
- `scripts/hooks-check.cjs` - Pre-commit hook references
- `.githooks/pre-commit` - Git hook script

---

## 🧪 9. Test Files

### Test Suites
- `test/admin.test.ts` - "STREAMLINE ADMIN CONTROLS TEST SUITE"
- Import paths: `'../streamline-server/firebaseAdmin'`

### Integration Tests
- Various test files referencing streamline paths

---

## 📊 10. Summary Statistics

**Estimated Total References:** 500+ instances

**BUT WAIT:** 90% of these are internal (imports, folder names, comments) that users never see.

**What users actually see:** ~50 instances across 15 files

### Breakdown by Type:
- **👁️ USER-VISIBLE (essentials):** 50 instances in 15 UI files ← **START HERE**
- **🔧 Internal code (optional):** 300+ import paths, comments, folder references
- **📝 Documentation (optional):** 100+ markdown files
- **⚙️ Configuration (optional):** 30+ config files
- **🌐 Infrastructure (required):** 6 domains/URLs to update

### Breakdown by Priority:
### Breakdown by Priority:
- **🔴 CRITICAL (do these):** User-facing UI text, domain, email
- **🟡 NICE TO HAVE:** Documentation, comments, package names  
- **🟢 OPTIONAL:** Folder names, import paths, infrastructure names

---

## 🚨 Critical Areas Requiring Special Attention

> **Note:** If you're only doing public branding (recommended), you only need items marked with 🎯

### 1. **Infrastructure & Deployment** 🎯 (Partial)
- 🎯 Domain names (DNS records) - **USER-VISIBLE**
- ⚙️ Render.com service names (requires dashboard changes) - Internal, optional
- ⚙️ GitHub repository name - Internal, optional  
- 🎯 SSL certificates tied to domains - **REQUIRED FOR NEW DOMAIN**

### 2. **External Services**
- 🎯 Email domain (support@streamline.app) - **USER-VISIBLE**
- ⚙️ R2 bucket names (may need migration) - Internal, can keep old name
- ⚙️ Firebase collections/documents - Internal, can keep old name
- ⚙️ LiveKit room naming conventions - Internal, invisible to users

### 3. **Database & Storage** (All Optional)
- ⚙️ Firestore collection names - Users don't see this
- ⚙️ R2 bucket: `streamline-recordings` - Internal identifier
- ⚙️ Any hardcoded database paths - Backend only

### 4. **Third-Party Integrations** (Update Only If They Show Branding)
- 🔍 OAuth redirect URLs - Update if contains brand name
- ⚙️ Webhook URLs - Usually generic paths, optional
- ⚙️ API callback URLs - Internal
- ⚙️ Stripe product/price IDs - Backend only, users see display names

### 5. **CSS & Assets** 🎯
- 🎯 Image alt text (logo descriptions) - **USER-VISIBLE** (accessibility + SEO)
- ⚙️ CSS class names with "streamline" prefix - Internal, works fine as-is
- ⚙️ Favicon references - Update if filename changes
- 🎯 Image filenames (if referenced in UI) - **USER-VISIBLE** in some contexts

---

## 📋 Recommended Change Order

### 🚀 FAST TRACK: Public Branding Only (2-4 hours)

**If you just need to avoid branding conflicts and update what users see:**

1. ✅ Choose new name & check domain availability
2. ✅ Update ~15 UI files (see "Quick-Hit File List" above)
3. ✅ Update domain in DNS + `streamline-client/src/lib/apiBase.ts`
4. ✅ Update support email in `SettingsBilling.tsx`
5. ✅ Deploy and test user flows
6. ✅ Done - you're rebranded to users

**Skip all the internal stuff (package names, comments, folder names) - it doesn't matter for public perception.**

---

### 🔧 FULL OVERHAUL: Complete Technical Rebrand (Optional)

**Only do this if you want pristine internal consistency or are preparing for open source:**

#### Phase 1: Preparation
1. ✅ **This inventory** (DONE)
2. Choose new name
3. Check trademark/domain availability
4. Plan downtime window

#### Phase 2: Infrastructure (Do First)
1. Set up new GitHub repository (optional - can keep current)
2. Register new domains
3. Create new Render services (or just rename existing)
4. Set up new R2 buckets (or keep existing)
5. Configure new email addresses

#### Phase 3: Code Changes
1. Update package.json names
2. Rename directories (`streamline-client` → `[newname]-client`)
3. Find/replace in code comments
4. Update import paths (IDE refactoring)
5. Update environment variable names
6. Update configuration files

#### Phase 4: User-Facing Content
1. Update all UI text/labels
2. Update legal pages
3. Update marketing pages
4. Update documentation
5. Update README files

#### Phase 5: Deployment
1. Deploy to new infrastructure
2. Update DNS records
3. Set up redirects from old domains
4. Test all integrations
5. Monitor for issues

#### Phase 6: Cleanup
1. Maintain old domains for 6-12 months (redirects)
2. Update external references (documentation, social media)
3. Archive old infrastructure

---

## 🔍 Search Patterns for Manual Review

Use these regex patterns to find additional references:

```regex
streamline           # Case-insensitive general search
StreamLine          # CamelCase variant
STREAMLINE          # Uppercase variant
stream-line         # Hyphenated variant
streamLine          # camelCase variant
```

---

## 📝 Notes

- Most references are straightforward find/replace operations
- Import paths will need careful attention (TypeScript may help)
- Test thoroughly after each phase
- Consider feature flags to enable gradual rollout
- Keep old branding in parallel during transition period
- Document all external service changes

---

**Next Steps:**

### For Public Branding (Fast Track):
1. ✅ Review "THE ESSENTIALS" section above
2. Choose new name (check domain availability)
3. Make a coffee ☕
4. Update the ~15 UI files listed
5. Update domain + email
6. Deploy and test
7. You're done in an afternoon

### For Complete Technical Overhaul (Optional):
1. Review full inventory with your team
2. Decide on new name
3. Create detailed migration plan with timeline
4. Set up parallel infrastructure before making code changes
5. Start with non-production environments first

**Remember:** Users don't see your folder names, package.json, or import paths. Focus on what matters.
