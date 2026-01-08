


/**
 * StreamLine Editing Plans Setup Script
 * 
 * This script creates/updates the 'plans' collection in Firestore
 * with editing feature limits for each subscription tier.
 * 
 * Run from your project ROOT folder (where package.json is):
 *   node setup-editing-plans.js
 * 
 * Prerequisites:
 *   - npm install firebase-admin dotenv
 *   - Your Firebase service account key JSON file
 *   - .env file with GOOGLE_APPLICATION_CREDENTIALS path
 */



const admin = require('firebase-admin');
const serviceAccount = require("./streamline-server/server/firebaseServiceAccount.json");

// Initialize Firebase Admin with service account
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
}

const db = admin.firestore();

// ============================================================
// PLAN DEFINITIONS
// ============================================================

const EDITING_PLANS = {
  free: {
    id: 'free',
    name: 'Free',
    description: 'Basic streaming only, no editing access',
    editing: {
      access: false,
      maxProjects: 0,
      maxStorageGB: 0,
      maxStorageBytes: 0,
      maxTracks: 0,
      maxResolution: null,        // null = no access
      exportsPerMonth: 0,
      unlimitedExports: false,
      ai: {
        autoCut: false,
        captions: false,
        highlights: false,
      },
      transitions: {
        basic: false,             // fade, crossfade
        advanced: false,          // slide, zoom, etc.
      },
      export: {
        watermark: true,          // free users get watermark
        priorityQueue: false,
        directUpload: false,      // upload to YouTube/etc directly
        multiPlatform: false,     // upload to multiple at once
      },
    },
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  },

  basic: {
    id: 'basic',
    name: 'Basic',
    description: 'Entry-level editing with basic features',
    editing: {
      access: true,
      maxProjects: 2,
      maxStorageGB: 3,
      maxStorageBytes: 3 * 1024 * 1024 * 1024, // 3 GB in bytes
      maxTracks: 2,
      maxResolution: null,        // null = no restriction but also no 1080p/4K guarantee
      exportsPerMonth: 5,
      unlimitedExports: false,
      ai: {
        autoCut: false,
        captions: false,
        highlights: false,
      },
      transitions: {
        basic: true,              // fade, crossfade
        advanced: false,
      },
      export: {
        watermark: true,          // basic still has watermark
        priorityQueue: false,
        directUpload: false,
        multiPlatform: false,
      },
    },
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  },

  starter: {
    id: 'starter',
    name: 'Starter',
    description: 'Growing creators with more editing power',
    editing: {
      access: true,
      maxProjects: 5,
      maxStorageGB: 15,
      maxStorageBytes: 15 * 1024 * 1024 * 1024, // 15 GB in bytes
      maxTracks: 3,
      maxResolution: '1080p',
      exportsPerMonth: 10,
      unlimitedExports: false,
      ai: {
        autoCut: false,
        captions: false,
        highlights: false,
      },
      transitions: {
        basic: true,
        advanced: false,
      },
      export: {
        watermark: false,         // no watermark
        priorityQueue: false,
        directUpload: true,       // can upload directly to platforms
        multiPlatform: false,
      },
    },
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  },

  pro: {
    id: 'pro',
    name: 'Pro',
    description: 'Professional creators with full editing suite',
    editing: {
      access: true,
      maxProjects: 10,
      maxStorageGB: 25,
      maxStorageBytes: 25 * 1024 * 1024 * 1024, // 25 GB in bytes
      maxTracks: 6,
      maxResolution: '4k',
      exportsPerMonth: -1,        // -1 = unlimited
      unlimitedExports: true,
      ai: {
        autoCut: false,           // AI features still false per your spec
        captions: false,
        highlights: false,
      },
      transitions: {
        basic: true,
        advanced: true,           // slide, zoom, wipe, etc.
      },
      export: {
        watermark: false,
        priorityQueue: true,      // exports process faster
        directUpload: true,
        multiPlatform: true,      // upload to multiple platforms at once
      },
    },
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  },

  enterprise: {
    id: 'enterprise',
    name: 'Enterprise',
    description: 'Custom enterprise solution - limits configured per account',
    editing: {
      access: true,
      maxProjects: 0,             // 0 = configured separately per enterprise account
      maxStorageGB: 0,
      maxStorageBytes: 0,
      maxTracks: 0,
      maxResolution: null,        // configured per account
      exportsPerMonth: 0,
      unlimitedExports: false,    // configured per account
      ai: {
        autoCut: false,
        captions: false,
        highlights: false,
      },
      transitions: {
        basic: false,
        advanced: false,
      },
      export: {
        watermark: false,
        priorityQueue: false,
        directUpload: false,
        multiPlatform: false,
      },
    },
    // Enterprise accounts have custom overrides stored in their user doc
    customizable: true,
    contactSales: true,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  },
};

// ============================================================
// SCRIPT EXECUTION
// ============================================================

async function setupEditingPlans() {
  console.log('\n🚀 StreamLine Editing Plans Setup\n');
  console.log('='.repeat(50));

  const plansCollection = db.collection('plans');
  const results = { created: [], updated: [], errors: [] };

  for (const [planId, planData] of Object.entries(EDITING_PLANS)) {
    try {
      console.log(`\n📋 Processing: ${planData.name} plan...`);

      const docRef = plansCollection.doc(planId);
      const existingDoc = await docRef.get();

      if (existingDoc.exists) {
        // Update existing document (preserve createdAt)
        const updateData = { ...planData };
        delete updateData.createdAt; // Don't overwrite original creation date
        updateData.updatedAt = admin.firestore.FieldValue.serverTimestamp();

        await docRef.update(updateData);
        console.log(`   ✅ Updated existing "${planId}" plan`);
        results.updated.push(planId);
      } else {
        // Create new document
        await docRef.set(planData);
        console.log(`   ✅ Created new "${planId}" plan`);
        results.created.push(planId);
      }

      // Log key limits
      const e = planData.editing;
      console.log(`      Access: ${e.access}`);
      console.log(`      Projects: ${e.maxProjects}, Storage: ${e.maxStorageGB}GB, Tracks: ${e.maxTracks}`);
      console.log(`      Resolution: ${e.maxResolution || 'none'}, Exports/mo: ${e.unlimitedExports ? 'unlimited' : e.exportsPerMonth}`);

    } catch (error) {
      console.log(`   ❌ Error with "${planId}": ${error.message}`);
      results.errors.push({ planId, error: error.message });
    }
  }

  // Summary
  console.log('\n' + '='.repeat(50));
  console.log('📊 Summary:');
  console.log(`   Created: ${results.created.length} (${results.created.join(', ') || 'none'})`);
  console.log(`   Updated: ${results.updated.length} (${results.updated.join(', ') || 'none'})`);
  console.log(`   Errors: ${results.errors.length}`);
  
  if (results.errors.length > 0) {
    console.log('\n⚠️  Errors:');
    results.errors.forEach(e => console.log(`   - ${e.planId}: ${e.error}`));
  }

  console.log('\n✨ Done!\n');
  console.log('Next steps:');
  console.log('  1. Check Firebase Console → Firestore → "plans" collection');
  console.log('  2. Create the useEditingFeatures() hook to read these limits');
  console.log('  3. Apply limits in your editor UI and API endpoints\n');
}

// Run the script
setupEditingPlans()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('\n💥 Script failed:', error);
    process.exit(1);
  });