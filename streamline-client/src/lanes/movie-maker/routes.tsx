/**
 * Movie Maker Lane — Route Registry
 *
 * All Movie Maker routes are defined here.
 * Shared pages are imported from @/core/pages.
 * Editing features live in this lane's features directory.
 */
import { Route, Navigate } from "react-router-dom";

// ── Core shared pages ────────────────────────────────────────────────
import Welcome from "@/core/pages/Welcome";
import Join from "@/core/pages/Join";
import Room from "@/core/pages/Room";
import Live from "@/core/pages/Live";
import RoomExitPage from "@/core/pages/RoomExitPage";
import PostStreamSummary from "@/core/pages/PostStreamSummary";
import SettingsDestinations from "@/core/pages/SettingsDestinations";
import SettingsBilling from "@/core/pages/SettingsBilling";
import LearnMore from "@/core/pages/LearnMore";
import Checkout from "@/core/pages/Checkout";
import PricingExplainerPage from "@/core/pages/PricingExplainerPage";
import InviteLanding from "@/core/pages/InviteLanding";
import InviteRedeem from "@/core/pages/InviteRedeem";
import MyContentDisabled from "@/core/pages/MyContentDisabled";
import EditorDisabled from "@/core/pages/EditorDisabled";
import AdminUsage from "@/core/pages/AdminUsage";
import AdminDashboard from "@/core/pages/AdminDashboard";

// ── Movie Maker editing features ─────────────────────────────────────
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
export interface MovieMakerRouteFlags {
  canContentLibrary: boolean;
  canMyContentRecordings: boolean;
  canProjects: boolean;
  canEditor: boolean;
  canMyContent: boolean;
  myContentTarget: string | null;
}

export function movieMakerRoutes(flags: MovieMakerRouteFlags) {
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
