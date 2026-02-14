# 🎬 StreamLine - Video Recording & Editing Platform

A complete MVP for live streaming, recording, and video editing. Built with React, TypeScript, Express, LiveKit, and Firebase.

## ✨ Features

### 📹 Live Streaming
- **LiveKit Integration** - Real-time video streaming
- **Auto-Recording** - Automatically records when host joins
- **Viewer Analytics** - Track viewer count and peak viewers
- **Host/Guest Roles** - Different experiences for hosts and participants

### 📊 Recording Management
- **Server-backed Recordings** - Recording state stored in Firestore (survives refresh)
- **Room Exit Page** - `/room-exit/:recordingId` shows status and next steps
- **Signed Downloads** - Signed URLs for downloading recorded media (when storage is configured)
- **Legacy Redirect** - `/stream-summary/:recordingId` redirects to `/room-exit/:recordingId`

### 🎞️ Video Editor
- **Timeline Editor** - Visual timeline with clip management
- **Clip Operations**:
  - ✂️ **Split** - Cut clips at playhead position
  - 📏 **Trim** - Trim clips to playhead
  - 🗑️ **Delete** - Remove clips from timeline
- **Playback Controls** - Play, pause, seek with timeline scrubbing
- **Zoom Control** - 50% to 300% timeline zoom
- **Export Options** - Choose resolution (720p, 1080p, 4K) and format (MP4, WebM)

### 📚 Asset Library
- Browse recordings and sample assets
- Filter by source (stream/upload)
- Search functionality
- Quick project creation

### 🎛️ Projects Dashboard
- Create and manage projects
- Select assets for editing
- Save timeline edits
- Project status tracking

### 👤 User Dashboard
- **Stats Overview**:
  - Total recordings
  - Peak viewers
  - Hours streamed
  - Projects created
- **Recent Recordings** grid
- **Recent Projects** grid
- Quick navigation to features

### 🔐 Authentication
- Email/Password signup and login
- Firebase/Firestore user management
- JWT token-based sessions
- Plan-based feature access

### 📊 Usage Tracking
- Track minutes streamed per month
- Plan-based hour limits
- Monthly usage reset
- YTD (Year-to-date) tracking
- Peak viewer count tracking

### 🎯 Feature Flags
**4 Subscription Tiers:**
- **Free**: 2 tracks, 3 projects, 3 hours/month
- **Starter**: 4 tracks, 10 projects, 10 hours/month
- **Pro**: 8 tracks, 100 projects, 40 hours/month, AI features
- **Enterprise**: 16 tracks, 1000 projects, unlimited hours, AI features

## 🚀 Quick Start

### Prerequisites
- Node.js 16+
- npm or yarn
- Firebase account (for backend)
- LiveKit account (for video streaming)

### Installation

**1. Clone repository**
```bash
git clone https://github.com/yourusername/video-editor-add.git
cd video-editor-add
```

**2. Setup Client**
```bash
cd streamline-client
npm install
npm run build
```

**3. Setup Server**
```bash
cd ../streamline-server
npm install
cp .env.example .env
# Fill in Firebase and LiveKit credentials
npm run dev
```

**4. Access Application**
Open http://localhost:5137 in your browser

## 📁 Project Structure

```
streamline/
├── streamline-client/          # React + Vite frontend
│   ├── src/
│   │   ├── pages/             # Auth, Join, Room, Dashboard
│   │   ├── components/        # UsageBanner, RoleOverlay
│   │   ├── editing/           # Editor, AssetLibrary, Projects
│   │   ├── hooks/             # Feature/entitlement hooks
│   │   ├── services/          # API integration
│   │   └── App.tsx            # Main routing
│   └── package.json
│
├── streamline-server/          # Express backend
│   ├── server/
│   │   ├── index.ts           # Main server, auth endpoints
│   │   ├── firebaseAdmin.ts   # Firebase setup
│   │   ├── livekitClient.ts   # LiveKit integration
│   │   └── routes/            # API routes
│   ├── usagePlans.ts          # Plan definitions
│   └── package.json
│
├── QUICKSTART.md              # 5-min quick start
├── TEST_PLAN.md               # Step-by-step testing
├── IMPLEMENTATION_GUIDE.md    # Technical details
├── IMPLEMENTATION_SUMMARY.md  # Complete overview
└── CHECKLIST.md               # Feature checklist
```

## 🔗 Key Routes

### Frontend Routes
- `/` - Welcome page
- `/login` - User login
- `/signup` - User signup
- `/dashboard` - User dashboard with stats
- `/join` - Create/join room
- `/room/:roomName` - Live streaming room
- `/room-exit/:recordingId` - Exit flow with options
- `/stream-summary/:recordingId` - Legacy redirect to `/room-exit/:recordingId`
- `/content` - Asset library (canonical)
- `/projects` - Projects dashboard (canonical)
- `/editing/assets` - Legacy redirect to `/content`
- `/editing/projects` - Legacy redirect to `/projects`
- `/editing/editor/:projectId` - Timeline video editor

### Backend API Routes
- `POST /api/auth/login` - User login
- `POST /api/auth/signup` - User signup
- `POST /api/rooms/{roomId}/token` - Get LiveKit room token (RTC)
- `POST /api/usage/streamEnded` - Log stream completion
- `GET /api/usage/summary` - Get user usage stats
  - Response header: `x-sl-usage-summary-version: v1`
- `POST /api/editing/*` - Editing API endpoints
- `POST /api/rooms/*` - Multistream endpoints

## 🛠️ Tech Stack

### Frontend
- **React 18** - UI library
- **TypeScript** - Type safety
- **Vite** - Build tool
- **Tailwind CSS** - Styling
- **React Router v6** - Routing
- **LiveKit SDK** - Video streaming client

### Backend
- **Express.js** - Web framework
- **TypeScript** - Type safety
- **Firebase Admin SDK** - User management
- **Firestore** - Database
- **LiveKit Server SDK** - Video streaming
- **bcryptjs** - Password hashing
- **jsonwebtoken** - JWT auth

### Infrastructure
- **Localhost:5137** - Single port architecture
- **localStorage** - Auth token and small UI state (not source of truth for recordings)
- **Firebase/Firestore** - User & data storage

## 📝 Features Implemented

### Phase 1 ✅
- [x] User authentication (signup/login)
- [x] Live streaming room
- [x] Auto-recording on host join
- [x] Recording status tracking
- [x] Post-stream exit flow (`/room-exit/:recordingId`)

### Phase 2 ✅
- [x] Legacy redirect `/stream-summary/:recordingId` → `/room-exit/:recordingId`
- [x] Asset library with filtering
- [x] Projects dashboard with CRUD
- [x] Timeline video editor

### Phase 3 ✅
- [x] Clip split functionality
- [x] Clip trim functionality
- [x] Clip delete functionality
- [x] Project export with options
- [x] User dashboard with stats

### Phase 4 (Deferred)
- [ ] Real LiveKit recording egress
- [ ] Cloud storage (GCS/S3)
- [ ] Auto-transcription (AssemblyAI)
- [ ] Auto-highlights detection
- [ ] YouTube/Facebook integration

## 🧪 Testing

Follow [TEST_PLAN.md](TEST_PLAN.md) for complete testing guide:

```
1. Signup with email/password
2. Create/join room
3. Stream for 30+ seconds
4. End stream → see exit page
5. Go to editor
7. Test clip operations (split, trim, delete)
8. Export project with options
9. View dashboard
10. Verify usage tracking
```

## 🔄 Data Flow

```
User Signup
  ↓
Firestore: Create user doc
  ↓
User Login
  ↓
JWT token created → localStorage
  ↓
Join Room
  ↓
LiveKit token generated
  ↓
Host starts recording
  ↓
Firestore: recording document created/updated
  ↓
Stream ends → Usage logged to Firestore
  ↓
Post-stream exit page (`/room-exit/:recordingId`)
  ↓
Optional: open `/content` → Create Project → `/editing/editor/new?recordingId=...`
```

## 📊 Usage Tracking

**Per Stream:**
- Minutes streamed
- Guest/participant count
- Peak viewers

**Monthly:**
- Total hours (plan-based limit)
- Usage reset date
- YTD hours
- Guest count total

**Data Structure:**
```firestore
users/{uid}
  ├── displayName
  ├── email
  ├── plan (free/starter/pro/enterprise)
  └── usage
      ├── hoursStreamedThisMonth
      ├── ytdHours
      ├── resetDate
      └── lastUsageUpdate

recordings/{recordingId}
  ├── title
  ├── createdAt
  ├── durationSeconds
  ├── status
  ├── viewerCount
  └── peakViewers
```

## 🚀 Deployment

### Production Checklist
- [ ] Real LiveKit server configured
- [ ] Firebase project setup
- [ ] Cloud storage (GCS/S3) configured
- [ ] Environment variables set
- [ ] SSL certificates
- [ ] Database backups
- [ ] Monitoring & logging
- [ ] Rate limiting
- [ ] Input validation
- [ ] Error handling

### Environment Variables
```bash
# Backend (.env)
PORT=5137
LIVEKIT_URL=wss://your-livekit.example.com
LIVEKIT_API_KEY=your_api_key
LIVEKIT_API_SECRET=your_api_secret
JWT_SECRET=your_jwt_secret
FIREBASE_PROJECT_ID=your_project
FIREBASE_PRIVATE_KEY=your_key
FIREBASE_CLIENT_EMAIL=your_email

# Frontend (.env)
VITE_API_BASE=http://localhost:5137
```

## 📖 Documentation

- **[QUICKSTART.md](QUICKSTART.md)** - 5-minute overview
- **[TEST_PLAN.md](TEST_PLAN.md)** - Complete testing guide
- **[IMPLEMENTATION_GUIDE.md](IMPLEMENTATION_GUIDE.md)** - Technical deep dive
- **[IMPLEMENTATION_SUMMARY.md](IMPLEMENTATION_SUMMARY.md)** - Feature list
- **[CHECKLIST.md](CHECKLIST.md)** - Implementation status

## 🐛 Known Limitations

### Current (MVP)
- Video URL hardcoded to BigBuckBunny sample
- Recording media/download availability depends on storage configuration
- Real recording egress/transcoding depends on LiveKit + backend setup
- No multi-track timeline yet
- No effects/transitions
- No real transcription

### Next Phase
- Real LiveKit egress recording
- Cloud storage integration
- Actual video processing
- Multi-track timeline
- Effects library
- AI features (captions, highlights)

## 🤝 Contributing

1. Create feature branch (`git checkout -b feature/amazing-feature`)
2. Commit changes (`git commit -m 'Add amazing feature'`)
3. Push to branch (`git push origin feature/amazing-feature`)
4. Open Pull Request

## 📄 License

MIT License - see LICENSE file for details

## 💬 Support

For issues, questions, or suggestions:
- Open an issue on GitHub
- Check existing documentation
- Review TEST_PLAN.md for common issues

## 🎯 Roadmap

**Q1 2025**
- Real video recording & processing
- Cloud storage integration
- Mobile app

**Q2 2025**
- AI-powered features
- Advanced editing tools
- Team collaboration

**Q3 2025**
- Live streaming analytics
- Monetization features
- Creator marketplace

## 👨‍💻 Author

Created as a complete MVP for video streaming and editing platform.

---

**Happy Streaming! 🚀**
