# PowerShell script to start backend and ngrok
# Usage: .\start-dev.ps1

Write-Host "Starting StreamLine backend..."
Start-Process powershell -ArgumentList '-NoExit','-Command','cd ../streamline-server; npm run dev' -WindowStyle Minimized

Write-Host "Starting ngrok tunnel on port 3001..."
Start-Process ngrok -ArgumentList 'http 3001' -WindowStyle Minimized

Write-Host "Both backend and ngrok started. Use get-ngrok-urls.ps1 to fetch tunnel URLs."