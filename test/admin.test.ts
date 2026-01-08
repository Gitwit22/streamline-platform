/**
 * Admin Controls Test Suite
 * Tests for Milestone 8 - Admin Controls
 * 
 * Run with: npm test admin.test.ts
 * Or manually test each endpoint
 */

import fetch from 'node-fetch';

const API_BASE = process.env.API_BASE || 'http://localhost:5137';
const ADMIN_USER_ID = process.env.ADMIN_USER_ID || 'test-admin-123';
const TEST_USER_ID = process.env.TEST_USER_ID || 'test-user-456';

// Helper function to make admin API calls
async function adminRequest(
  endpoint: string,
  method: string = 'GET',
  body?: any
) {
  const url = `${API_BASE}${endpoint}`;
  const options: any = {
    method,
    headers: {
      'Content-Type': 'application/json',
    },
  };

  if (body) {
    options.body = JSON.stringify({
      ...body,
      adminUserId: ADMIN_USER_ID,
    });
  } else if (method === 'GET') {
    const urlObj = new URL(url);
    urlObj.searchParams.append('adminUserId', ADMIN_USER_ID);
    return fetch(urlObj.toString(), options);
  }

  return fetch(url, options);
}

// Test: Non-admin gets 403
async function testNonAdminBlocked() {
  console.log('\n🧪 TEST 1: Non-admin user gets 403');
  console.log('─'.repeat(60));

  try {
    const url = new URL(`${API_BASE}/api/admin/users`);
    url.searchParams.append('adminUserId', 'non-admin-user-999');

    const response = await fetch(url.toString());
    
    if (response.status === 403) {
      console.log('✅ PASS: Non-admin correctly blocked (403)');
      const data = await response.json();
      console.log('   Response:', data.message);
      return true;
    } else {
      console.log(`❌ FAIL: Expected 403, got ${response.status}`);
      return false;
    }
  } catch (error) {
    console.log('❌ ERROR:', error);
    return false;
  }
}

// Test: Admin can grant minutes and user becomes unblocked
async function testGrantMinutesUnblocks() {
  console.log('\n🧪 TEST 2: Admin can grant minutes and user becomes unblocked');
  console.log('─'.repeat(60));

  try {
    // Step 1: Get user's current state
    console.log('Step 1: Fetching user current state...');
    const userBefore = await adminRequest(`/api/admin/users/${TEST_USER_ID}`);
    
    if (!userBefore.ok) {
      console.log(`❌ FAIL: Could not fetch user (${userBefore.status})`);
      return false;
    }

    const userDataBefore = await userBefore.json();
    console.log(`   User: ${userDataBefore.user.email}`);
    console.log(`   Current usage: ${userDataBefore.currentMonthUsage} min`);
    console.log(`   Plan limit: ${userDataBefore.planLimit} min`);
    console.log(`   Blocked: ${userDataBefore.isBlocked}`);
    console.log(`   Bonus minutes: ${userDataBefore.user.bonusMinutes || 0}`);

    // Step 2: Grant bonus minutes
    console.log('\nStep 2: Granting 120 bonus minutes...');
    const grantResponse = await adminRequest(
      `/api/admin/users/${TEST_USER_ID}/grant-minutes`,
      'POST',
      {
        minutes: 120,
        reason: 'Test: Unblocking user',
      }
    );

    if (!grantResponse.ok) {
      console.log(`❌ FAIL: Could not grant minutes (${grantResponse.status})`);
      const error = await grantResponse.json();
      console.log('   Error:', error);
      return false;
    }

    const grantData = await grantResponse.json();
    console.log('   ✅ Minutes granted successfully');
    console.log(`   New bonus total: ${grantData.totalBonusMinutes} min`);

    // Step 3: Verify user is now unblocked
    console.log('\nStep 3: Verifying user is unblocked...');
    const userAfter = await adminRequest(`/api/admin/users/${TEST_USER_ID}`);
    const userDataAfter = await userAfter.json();

    console.log(`   Current usage: ${userDataAfter.currentMonthUsage} min`);
    console.log(`   Effective limit: ${userDataAfter.planLimit + (userDataAfter.user.bonusMinutes || 0)} min`);
    console.log(`   Blocked: ${userDataAfter.isBlocked}`);

    if (!userDataAfter.isBlocked) {
      console.log('\n✅ PASS: User successfully unblocked after granting minutes');
      return true;
    } else {
      console.log('\n❌ FAIL: User still blocked after granting minutes');
      return false;
    }
  } catch (error) {
    console.log('❌ ERROR:', error);
    return false;
  }
}

// Test: Admin can flip user to Pro and limits update immediately
async function testChangePlanUpdatesLimits() {
  console.log('\n🧪 TEST 3: Admin can change plan and limits update immediately');
  console.log('─'.repeat(60));

  try {
    // Step 1: Get user's current plan
    console.log('Step 1: Fetching user current plan...');
    const userBefore = await adminRequest(`/api/admin/users/${TEST_USER_ID}`);
    const userDataBefore = await userBefore.json();
    
    const oldPlan = userDataBefore.user.planId;
    const oldLimit = userDataBefore.planLimit;
    
    console.log(`   Current plan: ${oldPlan}`);
    console.log(`   Current limit: ${oldLimit} min`);

    // Step 2: Change plan to Pro
    console.log('\nStep 2: Changing plan to Pro...');
    const planChangeResponse = await adminRequest(
      `/api/admin/users/${TEST_USER_ID}/change-plan`,
      'POST',
      {
        newPlan: 'pro',
        reason: 'Test: Upgrade to Pro',
      }
    );

    if (!planChangeResponse.ok) {
      console.log(`❌ FAIL: Could not change plan (${planChangeResponse.status})`);
      const error = await planChangeResponse.json();
      console.log('   Error:', error);
      return false;
    }

    const planData = await planChangeResponse.json();
    console.log('   ✅ Plan changed successfully');
    console.log(`   Old plan: ${planData.oldPlan}`);
    console.log(`   New plan: ${planData.newPlan}`);

    // Step 3: Verify limits updated immediately
    console.log('\nStep 3: Verifying limits updated...');
    const userAfter = await adminRequest(`/api/admin/users/${TEST_USER_ID}`);
    const userDataAfter = await userAfter.json();

    console.log(`   New plan: ${userDataAfter.user.planId}`);
    console.log(`   New limit: ${userDataAfter.planLimit} min`);
    console.log(`   Percent used: ${userDataAfter.percentUsed.toFixed(1)}%`);

    if (userDataAfter.user.planId === 'pro' && userDataAfter.planLimit === 1200) {
      console.log('\n✅ PASS: Plan and limits updated immediately');
      
      // Cleanup: Restore original plan
      if (oldPlan !== 'pro') {
        console.log(`\nCleanup: Restoring original plan (${oldPlan})...`);
        await adminRequest(
          `/api/admin/users/${TEST_USER_ID}/change-plan`,
          'POST',
          {
            newPlan: oldPlan,
            reason: 'Test cleanup',
          }
        );
      }
      
      return true;
    } else {
      console.log('\n❌ FAIL: Plan or limits not updated correctly');
      return false;
    }
  } catch (error) {
    console.log('❌ ERROR:', error);
    return false;
  }
}

// Test: Admin can toggle billing
async function testToggleBilling() {
  console.log('\n🧪 TEST 4: Admin can toggle billing');
  console.log('─'.repeat(60));

  try {
    console.log('Step 1: Disabling billing...');
    const disableResponse = await adminRequest(
      `/api/admin/users/${TEST_USER_ID}/toggle-billing`,
      'POST',
      {
        enabled: false,
        reason: 'Test: Disable billing',
      }
    );

    if (!disableResponse.ok) {
      console.log(`❌ FAIL: Could not disable billing (${disableResponse.status})`);
      return false;
    }

    console.log('   ✅ Billing disabled');

    console.log('\nStep 2: Enabling billing...');
    const enableResponse = await adminRequest(
      `/api/admin/users/${TEST_USER_ID}/toggle-billing`,
      'POST',
      {
        enabled: true,
        reason: 'Test: Enable billing',
      }
    );

    if (!enableResponse.ok) {
      console.log(`❌ FAIL: Could not enable billing (${enableResponse.status})`);
      return false;
    }

    console.log('   ✅ Billing enabled');
    console.log('\n✅ PASS: Billing toggle works correctly');
    return true;
  } catch (error) {
    console.log('❌ ERROR:', error);
    return false;
  }
}

// Test: Admin can list users usage
async function testListUsersUsage() {
  console.log('\n🧪 TEST 5: Admin can list users usage');
  console.log('─'.repeat(60));

  try {
    const response = await adminRequest('/api/admin/usage?limit=10');
    
    if (!response.ok) {
      console.log(`❌ FAIL: Could not fetch usage (${response.status})`);
      return false;
    }

    const data = await response.json();
    console.log(`   Found ${data.usage.length} users`);
    
    if (data.usage.length > 0) {
      const sample = data.usage[0];
      console.log('\n   Sample user:');
      console.log(`   - Email: ${sample.email}`);
      console.log(`   - Plan: ${sample.planId}`);
      console.log(`   - Usage: ${sample.minutesUsed}/${sample.effectiveLimit} min`);
      console.log(`   - Status: ${sample.isBlocked ? 'BLOCKED' : 'ACTIVE'}`);
    }

    console.log('\n✅ PASS: Usage list retrieved successfully');
    return true;
  } catch (error) {
    console.log('❌ ERROR:', error);
    return false;
  }
}

// Test: Admin can toggle features
async function testFeatureToggle() {
  console.log('\n🧪 TEST 6: Admin can toggle features');
  console.log('─'.repeat(60));

  try {
    const testFeature = 'test_feature_' + Date.now();

    console.log(`Step 1: Enabling feature "${testFeature}"...`);
    const enableResponse = await adminRequest(
      '/api/admin/features/toggle',
      'POST',
      {
        featureName: testFeature,
        enabled: true,
        reason: 'Test: Enable feature',
      }
    );

    if (!enableResponse.ok) {
      console.log(`❌ FAIL: Could not enable feature (${enableResponse.status})`);
      return false;
    }

    console.log('   ✅ Feature enabled');

    console.log('\nStep 2: Verifying feature in list...');
    const listResponse = await adminRequest('/api/admin/features');
    const listData = await listResponse.json();
    
    const feature = listData.features.find((f: any) => f.name === testFeature);
    if (feature && feature.enabled === true) {
      console.log('   ✅ Feature found in list');
    } else {
      console.log('   ❌ Feature not found or not enabled');
      return false;
    }

    console.log('\nStep 3: Disabling feature...');
    const disableResponse = await adminRequest(
      '/api/admin/features/toggle',
      'POST',
      {
        featureName: testFeature,
        enabled: false,
        reason: 'Test cleanup',
      }
    );

    if (!disableResponse.ok) {
      console.log(`❌ FAIL: Could not disable feature (${disableResponse.status})`);
      return false;
    }

    console.log('   ✅ Feature disabled');
    console.log('\n✅ PASS: Feature toggle works correctly');
    return true;
  } catch (error) {
    console.log('❌ ERROR:', error);
    return false;
  }
}

// Test: Admin can view stats
async function testAdminStats() {
  console.log('\n🧪 TEST 7: Admin can view platform stats');
  console.log('─'.repeat(60));

  try {
    const response = await adminRequest('/api/admin/stats');
    
    if (!response.ok) {
      console.log(`❌ FAIL: Could not fetch stats (${response.status})`);
      return false;
    }

    const stats = await response.json();
    
    console.log('   Platform Statistics:');
    console.log(`   - Total Users: ${stats.totalUsers}`);
    console.log(`   - Active Today: ${stats.activeToday}`);
    console.log(`   - Active This Week: ${stats.activeThisWeek}`);
    console.log(`   - Active This Month: ${stats.activeThisMonth}`);
    console.log(`   - Total Minutes: ${Math.round(stats.totalMinutesUsed).toLocaleString()}`);
    console.log(`   - Avg Minutes/User: ${Math.round(stats.averageMinutesPerUser)}`);
    console.log('\n   Users by Plan:');
    Object.entries(stats.usersByPlan).forEach(([plan, count]) => {
      console.log(`   - ${plan}: ${count}`);
    });

    console.log('\n✅ PASS: Stats retrieved successfully');
    return true;
  } catch (error) {
    console.log('❌ ERROR:', error);
    return false;
  }
}

// Run all tests
async function runAllTests() {
  console.log('╔═══════════════════════════════════════════════════════════╗');
  console.log('║          STREAMLINE ADMIN CONTROLS TEST SUITE            ║');
  console.log('║                  Milestone 8 - Testing                    ║');
  console.log('╚═══════════════════════════════════════════════════════════╝');
  console.log(`\nAPI Base: ${API_BASE}`);
  console.log(`Admin User ID: ${ADMIN_USER_ID}`);
  console.log(`Test User ID: ${TEST_USER_ID}`);

  const tests = [
    { name: 'Non-admin blocked', fn: testNonAdminBlocked, required: true },
    { name: 'Grant minutes unblocks', fn: testGrantMinutesUnblocks, required: true },
    { name: 'Change plan updates limits', fn: testChangePlanUpdatesLimits, required: true },
    { name: 'Toggle billing', fn: testToggleBilling, required: false },
    { name: 'List users usage', fn: testListUsersUsage, required: false },
    { name: 'Feature toggle', fn: testFeatureToggle, required: false },
    { name: 'View stats', fn: testAdminStats, required: false },
  ];

  const results: { name: string; passed: boolean; required: boolean }[] = [];

  for (const test of tests) {
    try {
      const passed = await test.fn();
      results.push({ name: test.name, passed, required: test.required });
    } catch (error) {
      console.log(`\n❌ Test "${test.name}" threw an error:`, error);
      results.push({ name: test.name, passed: false, required: test.required });
    }
  }

  // Summary
  console.log('\n╔═══════════════════════════════════════════════════════════╗');
  console.log('║                      TEST SUMMARY                         ║');
  console.log('╚═══════════════════════════════════════════════════════════╝\n');

  const passed = results.filter((r) => r.passed).length;
  const failed = results.filter((r) => !r.passed).length;
  const requiredPassed = results.filter((r) => r.required && r.passed).length;
  const requiredTotal = results.filter((r) => r.required).length;

  results.forEach((result) => {
    const icon = result.passed ? '✅' : '❌';
    const req = result.required ? '[REQUIRED]' : '[OPTIONAL]';
    console.log(`${icon} ${req} ${result.name}`);
  });

  console.log(`\nTotal: ${passed}/${results.length} passed`);
  console.log(`Required: ${requiredPassed}/${requiredTotal} passed`);

  if (requiredPassed === requiredTotal) {
    console.log('\n🎉 ALL REQUIRED TESTS PASSED! ');
    console.log('   Exit criteria met - ready for production');
  } else {
    console.log('\n⚠️  SOME REQUIRED TESTS FAILED');
    console.log('   Fix failing tests before deploying');
  }

  return requiredPassed === requiredTotal;
}

// Export for use as module or run directly
if (require.main === module) {
  runAllTests()
    .then((success) => {
      process.exit(success ? 0 : 1);
    })
    .catch((error) => {
      console.error('Fatal error:', error);
      process.exit(1);
    });
}

export { runAllTests, testNonAdminBlocked, testGrantMinutesUnblocks, testChangePlanUpdatesLimits };