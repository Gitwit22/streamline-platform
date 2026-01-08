# PowerShell script to update .env files with new ngrok URLs
# Usage: .\update-env-ngrok.ps1

$ngrokApi = "http://127.0.0.1:4040/api/tunnels"
try {
    $response = Invoke-RestMethod -Uri $ngrokApi
    $url = $response.tunnels[0].public_url
    $envPath = "../streamline-server/.env"
    (Get-Content $envPath) -replace 'NGROK_URL=.*', "NGROK_URL=$url" | Set-Content $envPath
    Write-Host "Updated $envPath with NGROK_URL=$url"
} catch {
    Write-Host "Could not update .env. Is ngrok running?"
}