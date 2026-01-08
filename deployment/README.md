# StreamLine Editing Suite: Deployment & Ngrok Setup

This folder contains scripts and documentation for local development, ngrok integration, and secure OAuth setup.

## Contents
- `start-dev.ps1`: PowerShell script to start server and ngrok
- `get-ngrok-urls.ps1`: Fetch current ngrok tunnel URLs
- `update-env-ngrok.ps1`: Update .env files with new ngrok URLs
- `README.md`: Setup instructions and troubleshooting

---

## Phase 1: Project Integration
- Ensure `.env` files exist in both `streamline-server` and `streamline-client`.
- Validate Firebase/Firestore config in `streamline-server/server/firebaseServiceAccount.json`.
- Confirm local testing for backend and frontend.

## Phase 2: Ngrok Configuration
- Install ngrok: https://ngrok.com/download
- Start ngrok tunnel for backend: `ngrok http 3001` (or your backend port)
- Update OAuth redirect URIs to use ngrok URLs.
- Adjust CORS and webhook settings for ngrok domains.

## Phase 3: Development Workflow
- Use provided scripts for startup and environment updates.
- Follow daily routine: start server, start ngrok, update URLs, test OAuth/webhooks.

## Security & Troubleshooting
- Review CORS and sensitive data exposure.
- See troubleshooting section for common issues.
