/**
 * Creator Lane — Route Registry
 *
 * All creator (a.k.a. "StreamLine Main") routes are defined here.
 * During the refactor these still import from the legacy locations;
 * as pages move into src/creator/pages/ the imports will update.
 *
 * Route paths are UNCHANGED — this is purely an organisational move.
 */
import { Route, Navigate } from "react-router-dom";

// ── Creator pages ─────────────────────────────────────────────────────
import Welcome from "./pages/Welcome";
import Join from "./pages/Join";
import Room from "./pages/Room";
import Live from "./pages/Live";
import RoomExitPage from "./pages/RoomExitPage";
import PostStreamSummary from "./pages/PostStreamSummary";
import SettingsDestinations from "./pages/SettingsDestinations";
import SettingsBilling from "./pages/SettingsBilling";
import LearnMore from "./pages/LearnMore";
import Checkout from "./pages/Checkout";
import PricingExplainerPage from "./pages/PricingExplainerPage";
import InviteLanding from "./pages/InviteLanding";
import InviteRedeem from "./pages/InviteRedeem";
import MyContentDisabled from "./pages/MyContentDisabled";
import EditorDisabled from "./pages/EditorDisabled";
import AdminUsage from "./pages/AdminUsage";
import AdminDashboard from "./pages/AdminDashboard";

// ── Editing sub-lane (creator-only) ──────────────────────────────────
import AssetLibrary from "./features/editing/AssetLibrary";
import ProjectsDashboard from "./features/editing/ProjectsDashboard";
import EditorPage from "./features/editing/EditorPage";
import RenderAndUploadPage from "./features/editing/pages/RenderAndUploadPage";

// ── Legacy redirect helper ───────────────────────────────────────────
import { useParams } from "react-router-dom";

function LegacyStreamSummaryRedirect() {
  const { recordingId } = useParams<{ recordingId: string }>();
  const target = recordingId
    ? `/room-exit/${encodeURIComponent(recordingId)}`
    : "/room-exit/unknown";
  return <Navigate to={target} replace state={{ exitRole: "host" }} />;
}

// ── Route builder ────────────────────────────────────────────────────
// Returns an array of <Route> elements.
// `access` flags are threaded in so feature-gated routes work.
export interface CreatorRouteFlags {
  canContentLibrary: boolean;
  canMyContentRecordings: boolean;
  canProjects: boolean;
  canEditor: boolean;
  canMyContent: boolean;
  myContentTarget: string | null;
}

export function creatorRoutes(flags: CreatorRouteFlags) {
  const {
    canContentLibrary,
    canMyContentRecordings,
    canProjects,
    canEditor,
    canMyContent,
    myContentTarget,
  } = flags;

  return (
    <>
      {/* Landing / marketing */}
      <Route path="/welcome" element={<Welcome />} />
      <Route path="/learnmore" element={<LearnMore />} />
      <Route path="/checkout" element={<Checkout />} />
      <Route path="/pricing/explainer" element={<PricingExplainerPage />} />

      {/* Invite landing */}
      <Route path="/i/:inviteToken" element={<InviteLanding />} />
      <Route path="/invite/:inviteId" element={<InviteRedeem />} />

      {/* Admin */}
      <Route path="/admin/usage" element={<AdminUsage />} />
      <Route path="/admin/dashboard" element={<AdminDashboard />} />

      {/* Streaming flow */}
      <Route path="/join" element={<Join />} />
      <Route
        path="/my-content"
        element={
          canMyContent && myContentTarget
            ? <Navigate to={myContentTarget} replace />
            : <MyContentDisabled />
        }
      />
      <Route path="/room" element={<Room />} />
      <Route path="/room/:roomName" element={<Room />} />
      <Route path="/live" element={<Live />} />
      <Route path="/live/:savedEmbedId" element={<Live />} />
      <Route path="/ig/:savedEmbedId" element={<Live />} />
      <Route path="/settings/destinations" element={<SettingsDestinations />} />
      <Route path="/room-exit/:recordingId" element={<RoomExitPage />} />

      {/* Legacy redirect */}
      <Route path="/stream-summary/:recordingId" element={<LegacyStreamSummaryRedirect />} />
      <Route path="/editing/post-stream" element={<PostStreamSummary />} />
      <Route path="/thanks" element={<Navigate to="/room-exit/unknown" replace />} />

      {/* Editing (blocked / gated) */}
      <Route path="/edit" element={<EditorDisabled />} />
      <Route path="/edit/:id" element={<EditorDisabled />} />
      <Route path="/editor" element={<EditorDisabled />} />
      <Route path="/editor/:id" element={<EditorDisabled />} />

      {/* Content library / projects */}
      <Route
        path="/content"
        element={
          canContentLibrary || canMyContentRecordings
            ? <AssetLibrary />
            : <Navigate to="/join" replace />
        }
      />
      <Route
        path="/projects"
        element={canProjects ? <ProjectsDashboard /> : <Navigate to="/join" replace />}
      />

      {/* Legacy editing aliases */}
      <Route
        path="/editing/assets"
        element={
          canContentLibrary || canMyContentRecordings
            ? <Navigate to="/content" replace />
            : <Navigate to="/join" replace />
        }
      />
      <Route
        path="/editing/projects"
        element={canProjects ? <Navigate to="/projects" replace /> : <Navigate to="/join" replace />}
      />
      <Route
        path="/editing/editor/:projectId"
        element={canEditor ? <EditorPage /> : <EditorDisabled />}
      />
      <Route
        path="/editing/export/:projectId"
        element={canEditor ? <RenderAndUploadPage /> : <EditorDisabled />}
      />

      {/* Billing */}
      <Route path="/settings/billing" element={<SettingsBilling />} />
    </>
  );
}
