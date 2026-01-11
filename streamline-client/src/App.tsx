import { Routes, Route } from "react-router-dom";
import AdminUsage from './pages/AdminUsage';
import AdminDashboard from './pages/AdminDashboard';

import Welcome from "./pages/Welcome";
import { LoginPage } from "./pages/LoginPage";
import { SignupPage } from "./pages/SignupPage";
import Join from "./pages/Join";
import Room from "./pages/Room";
import SettingsDestinations from "./pages/SettingsDestinations";
import RoomExitPage from "./pages/RoomExitPage";
import Dashboard from "./pages/Dashboard";
import StreamSummaryPage from "./pages/StreamSummaryPage";
import PostStreamSummary from "./pages/PostStreamSummary";
import AssetLibrary from "./editing/AssetLibrary";
import ProjectsDashboard from "./editing/ProjectsDashboard";
import EditorPage from "./editing/EditorPage";
import RenderAndUploadPage from "./editing/pages/RenderAndUploadPage";
import ThankYou from "./pages/ThankYou";
import EditorDisabled from "./pages/EditorDisabled";
import LearnMore from "./pages/LearnMore";
import Checkout from "./pages/Checkout";
import Privacy from "./pages/Privacy";
import Terms from "./pages/Terms";
import Support from "./pages/Support";
import BillingCanceled from "./pages/BillingCanceled";
import BillingSuccess from "./pages/BillingSuccess";
import { ProtectedRoute } from "./components/ProtectedRoute";


// Stripe/Billing pages
import SettingsBilling from "./pages/SettingsBilling";


function App() {
  return (
    <Routes>
      <Route path="/learnmore" element={<LearnMore />} />

      <Route path="/admin/usage" element={<AdminUsage />} />
      {/* Public / auth flow */}
      <Route path="/" element={<Welcome />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/signup" element={<SignupPage />} />
      <Route path="/checkout" element={<Checkout />} />
      {/* Policy & Support */}
      <Route path="/privacy" element={<Privacy />} />
      <Route path="/terms" element={<Terms />} />
      <Route path="/support" element={<Support />} />
      {/* Stripe Checkout return routes */}
      <Route path="/billing/canceled" element={<BillingCanceled />} />
      <Route path="/billing/success" element={<BillingSuccess />} />


      {/* User dashboard */}
      <Route path="/dashboard" element={<Dashboard />} />
      <Route path="/admin/dashboard" element={<AdminDashboard />} />
      {/* Streaming flow */}
      <Route path="/join" element={<Join />} />
      <Route path="/room/:roomName" element={<Room />} />
      <Route path="/settings/destinations" element={<SettingsDestinations />} />
      <Route path="/room-exit/:recordingId" element={<RoomExitPage />} />

      {/* Stream Summary */}
      <Route path="/stream-summary/:recordingId" element={<StreamSummaryPage />} />
      <Route path="/editing/post-stream" element={<PostStreamSummary />} />
      
      {/* Thank You / Post-Stream */}
      <Route path="/thanks" element={<ThankYou />} />

      {/* Blocked Editing Routes - Coming Soon */}
      <Route path="/edit" element={<EditorDisabled />} />
      <Route path="/edit/:id" element={<EditorDisabled />} />
      <Route path="/editor" element={<EditorDisabled />} />
      <Route path="/editor/:id" element={<EditorDisabled />} />
      <Route path="/editing/assets" element={<EditorDisabled />} />
      <Route path="/editing/projects" element={<EditorDisabled />} />
      <Route path="/editing/editor/:projectId" element={<EditorDisabled />} />
      <Route path="/editing/export/:projectId" element={<EditorDisabled />} />

      {/* Stripe/Billing routes */}
      <Route path="/settings/billing" element={<SettingsBilling />} />
      
    </Routes>
  );
}

export default App;