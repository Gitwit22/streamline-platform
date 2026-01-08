// Simple test script to verify usage tracking API
const API_BASE = "https://magdalena-bulllike-hildred.ngrok-free.dev";

async function testUsageAPI() {
  console.log("🧪 Testing Usage Tracking API...\n");

  // Test 1: Get usage summary for a test user
  console.log("1️⃣  Testing GET /api/usage/summary");
  try {
    const response = await fetch(`${API_BASE}/api/usage/summary?uid=test-user-123`);
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

  // Test 2: Record stream start
  console.log("2️⃣  Testing POST /api/usage/streamStarted");
  try {
    const response = await fetch(`${API_BASE}/api/usage/streamStarted`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ uid: "test-user-123" }),
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
      body: JSON.stringify({ uid: "test-user-123", guestCount: 3 }),
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
    const response = await fetch(`${API_BASE}/api/usage/summary?uid=test-user-123`);
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