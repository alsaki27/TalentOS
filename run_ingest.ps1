$ErrorActionPreference = 'Stop'

# Load variables from .env.local
Get-Content .env.local | ForEach-Object {
    if ($_ -match '^(.*?)=(.*)$') {
        $name = $matches[1].Trim()
        $value = $matches[2].Trim()
        # Remove surrounding quotes if present
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

# The pipeline API is running on localhost during dev
[Environment]::SetEnvironmentVariable('BASE_URL', "http://localhost:3000")
[Environment]::SetEnvironmentVariable('INGEST_SECRET', $ingestSecret)

Write-Host "Starting Mock Data Ingestion..." -ForegroundColor Cyan

# Run the python script
python scripts/openjobdata_ingest.py

Write-Host ""
Write-Host "Done!" -ForegroundColor Green
