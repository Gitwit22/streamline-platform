import { Routes, Route } from "react-router-dom";
import { Toaster } from "react-hot-toast";

import Welcome from "./pages/Welcome";
import { LoginPage } from "./pages/LoginPage";
import { SignupPage } from "./pages/SignupPage";
import Join from "./pages/Join";
import Room from "./pages/Room";
import EditorDisabled from "./pages/EditorDisabled";

// existing imports like Room, Dashboard, etc.

function App() {
  return (
    <>
      <Toaster position="top-right" />
      <Routes>
        {/* Public / auth flow */}
        <Route path="/" element={<Welcome />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/signup" element={<SignupPage />} />

        {/* Streaming flow */}
        <Route path="/join" element={<Join />} />
        <Route path="/room/:roomName" element={<Room />} />

        {/* Disabled editing routes */}
        <Route path="/editing/*" element={<EditorDisabled />} />
      </Routes>
    </>
  );
}

export default App;

