# PowerShell script to fetch current ngrok tunnel URLs
# Usage: .\get-ngrok-urls.ps1

$ngrokApi = "http://127.0.0.1:4040/api/tunnels"
try {
    $response = Invoke-RestMethod -Uri $ngrokApi
    $urls = $response.tunnels | Select-Object -ExpandProperty public_url
    Write-Host "Active ngrok URLs:" $urls
} catch {
    Write-Host "Could not fetch ngrok URLs. Is ngrok running?"
}