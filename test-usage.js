// Simple test script to verify usage tracking API
//
// Usage:
//   API_BASE=http://localhost:5137 node test-usage.js
//   API_BASE=https://your-dev.example.com TEST_UID=some-uid node test-usage.js
//
// By default this script is READ-ONLY (summary only). Opt in to mutations:
//   DO_MUTATIONS=1 API_BASE=... node test-usage.js

const API_BASE = process.env.API_BASE || "http://localhost:5137";
const TEST_UID = process.env.TEST_UID || "test-user-123";
const DO_MUTATIONS = process.env.DO_MUTATIONS === "1" || process.env.DO_MUTATIONS === "true";

const TEST_JWT = process.env.TEST_JWT || process.env.SMOKE_JWT || "";
const TEST_EMAIL = process.env.TEST_EMAIL || "";
const TEST_PASSWORD = process.env.TEST_PASSWORD || "";

async function loginAndGetJwt(email, password) {
  const res = await fetch(`${API_BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Login failed (${res.status}): ${text.slice(0, 200)}`);
  }
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  const token = json && json.token;
  if (!token || typeof token !== "string") {
    throw new Error("Login response missing token");
  }
  return token;
}

async function testUsageAPI() {
  console.log("🧪 Testing Usage Tracking API...\n");

  let jwt = TEST_JWT;
  if (!jwt && TEST_EMAIL && TEST_PASSWORD) {
    try {
      jwt = await loginAndGetJwt(TEST_EMAIL, TEST_PASSWORD);
    } catch (err) {
      console.log("💥 Login failed:", err.message);
      console.log("ℹ️  Skipping usage tests (auth not configured).\n");
      return;
    }
  }

  if (!jwt) {
    console.log("ℹ️  Skipping usage tests (set TEST_JWT or TEST_EMAIL+TEST_PASSWORD).\n");
    return;
  }

  // Test 1: Get usage summary for a test user
  console.log("1️⃣  Testing GET /api/usage/summary (auth required)");
  try {
    const response = await fetch(`${API_BASE}/api/usage/summary`, {
      headers: { Authorization: `Bearer ${jwt}` },
    });
    const data = await response.json();
    
    if (response.ok) {
      console.log("✅ Summary API working!");
      console.log("📊 Response:", JSON.stringify(data, null, 2));
    } else {
      console.log("❌ Summary API failed:", data);
    }
  } catch (err) {
    console.log("💥 Summary API error:", err.message);
  }

  console.log("\n" + "=".repeat(50) + "\n");

  if (!DO_MUTATIONS) {
    console.log("\nℹ️  Skipping mutation tests (set DO_MUTATIONS=1 to enable).\n");
    console.log("🎉 Usage API testing complete!");
    return;
  }

  // Test 2: Record stream start
  console.log("2️⃣  Testing POST /api/usage/streamStarted");
  try {
    const response = await fetch(`${API_BASE}/api/usage/streamStarted`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ uid: TEST_UID }),
    });
    const data = await response.json();
    
    if (response.ok) {
      console.log("✅ Stream start recording working!");
      console.log("📊 Response:", JSON.stringify(data, null, 2));
    } else {
      console.log("❌ Stream start failed:", data);
    }
  } catch (err) {
    console.log("💥 Stream start error:", err.message);
  }

  console.log("\n" + "=".repeat(50) + "\n");

  // Test 3: Record stream end (after a small delay)
  console.log("3️⃣  Testing POST /api/usage/streamEnded");
  try {
    // Wait a bit to simulate stream duration
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    const response = await fetch(`${API_BASE}/api/usage/streamEnded`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ uid: TEST_UID, guestCount: 3 }),
    });
    const data = await response.json();
    
    if (response.ok) {
      console.log("✅ Stream end recording working!");
      console.log("📊 Response:", JSON.stringify(data, null, 2));
    } else {
      console.log("❌ Stream end failed:", data);
    }
  } catch (err) {
    console.log("💥 Stream end error:", err.message);
  }

  console.log("\n" + "=".repeat(50) + "\n");

  // Test 4: Get updated usage summary
  console.log("4️⃣  Testing updated usage summary");
  try {
    const response = await fetch(`${API_BASE}/api/usage/summary`, {
      headers: { Authorization: `Bearer ${jwt}` },
    });
    const data = await response.json();
    
    if (response.ok) {
      console.log("✅ Updated summary received!");
      console.log("📊 Updated usage:", JSON.stringify(data, null, 2));
    } else {
      console.log("❌ Updated summary failed:", data);
    }
  } catch (err) {
    console.log("💥 Updated summary error:", err.message);
  }

  console.log("\n🎉 Usage API testing complete!");
}

// Run the test
testUsageAPI().catch(console.error);