$ErrorActionPreference = 'Stop'

# Load variables from .env.local
Get-Content .env.local | ForEach-Object {
    if ($_ -match '^(.*?)=(.*)$') {
        $name = $matches[1].Trim()
        $value = $matches[2].Trim()
        if ($value -match '^"(.*)"$') {
            $value = $matches[1]
        }
        [Environment]::SetEnvironmentVariable($name, $value)
    }
}

$ingestSecret = [Environment]::GetEnvironmentVariable('JOB_CEO_INGEST_SECRET')
if (-not $ingestSecret) {
    Write-Host "ERROR: Could not find JOB_CEO_INGEST_SECRET in .env.local" -ForegroundColor Red
    exit 1
}

$baseUrl = "http://localhost:3000"

# Create a realistic test job that matches the "OSP Engineer" criteria
$testJob = @{
    jobs = @(
        @{
            title = "OSP Fiber Design Engineer"
            company = "Test Telecom Corp"
            location = "Remote / USA"
            source_url = "https://example.com/job/123"
            external_job_id = "test-job-001"
            snippet = "We are looking for an experienced OSP Design Engineer to plan fiber networks."
            raw = @{
                source = "manual_test"
                posted_at = (Get-Date).ToString("yyyy-MM-ddTHH:mm:ssZ")
            }
        }
    )
}

$jsonBody = $testJob | ConvertTo-Json -Depth 10

Write-Host "Sending test job directly to Job CEO Ingest API..." -ForegroundColor Cyan

$response = Invoke-RestMethod -Uri "$baseUrl/api/job-ceo/ingest" `
    -Method Post `
    -Headers @{
        "Authorization" = "Bearer $ingestSecret"
        "Content-Type" = "application/json"
    } `
    -Body $jsonBody

Write-Host ""
Write-Host "Success!" -ForegroundColor Green
Write-Host "The Job CEO Pipeline has received the job and created a new Run." -ForegroundColor Green
Write-Host "Go check your Job CEO Dashboard at http://localhost:3000/job-ceo" -ForegroundColor Yellow
Write-Host "Response from server:"
$response | ConvertTo-Json
