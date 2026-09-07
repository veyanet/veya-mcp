$ErrorActionPreference = "Stop"
Set-Location "D:\Script\AirdropsVault\Scripts\projects\veya-privacy\robinhood\hosted-mcp"

# Wipe broken git state; keep files
Remove-Item -Recurse -Force .git
git init -b main
git remote add origin "https://github.com/veyanet/veya-mcp.git"

$env:GIT_AUTHOR_NAME = "veyanet"
$env:GIT_AUTHOR_EMAIL = "tonyiron9225@gmail.com"
$env:GIT_COMMITTER_NAME = "veyanet"
$env:GIT_COMMITTER_EMAIL = "tonyiron9225@gmail.com"

function Commit-TreeMsg([string]$message) {
  $tree = (git write-tree).Trim()
  if (-not $tree) { throw "write-tree failed" }
  $msgFile = Join-Path $env:TEMP "veya-mcp-ct.txt"
  [System.IO.File]::WriteAllText($msgFile, ($message.TrimEnd() + "`n"))

  $parent = $null
  cmd /c "git rev-parse HEAD >%TEMP%\veya-head.txt 2>nul"
  if ($LASTEXITCODE -eq 0 -and (Test-Path (Join-Path $env:TEMP "veya-head.txt"))) {
    $parent = (Get-Content (Join-Path $env:TEMP "veya-head.txt") -Raw).Trim()
    if (-not $parent) { $parent = $null }
  }

  if ($parent) {
    $commit = (git commit-tree $tree -p $parent -F $msgFile).Trim()
  } else {
    $commit = (git commit-tree $tree -F $msgFile).Trim()
  }
  if (-not $commit -or $commit.Length -lt 40) { throw "commit-tree failed: $commit" }
  git update-ref refs/heads/main $commit
  git symbolic-ref HEAD refs/heads/main | Out-Null

  $body = git log -1 --format=%B
  if ($body -match "Co-authored-by:") { throw "Co-authored-by present" }
  $author = git log -1 --format="%an <%ae>"
  if ($author -ne "veyanet <tonyiron9225@gmail.com>") { throw "bad author $author" }
  Write-Host ("OK {0} {1}" -f $commit.Substring(0,7), (git log -1 --format=%s))
}

function Stage([string[]]$paths) {
  git add -- $paths
}

Stage @("package.json","tsconfig.json","tsup.config.ts")
Commit-TreeMsg "chore: scaffold @veyanet/mcp package and TypeScript build"

Stage @(".gitignore",".env.example")
Commit-TreeMsg "chore: add gitignore and environment template"

Stage @("src/config.ts")
Commit-TreeMsg "feat: load Robinhood testnet MCP service config"

Stage @("src/auth.ts")
Commit-TreeMsg "feat: enforce Bearer auth for on-chain write tools"

Stage @("src/sdk.ts")
Commit-TreeMsg "feat: bridge read and write clients to @veyanet/sdk"

Stage @("src/tools/public.ts")
Commit-TreeMsg "feat: register public describe ping hash verify and health tools"

Stage @("src/tools/write.ts")
Commit-TreeMsg "feat: register authenticated commitment attest and environment writes"

Stage @("src/server.ts","src/index.ts")
Commit-TreeMsg "feat: assemble MCP server and public package exports"

Stage @("src/http.ts")
Commit-TreeMsg "feat: serve Streamable HTTP MCP health and landing endpoints"

Stage @("src/cli.ts")
Commit-TreeMsg "feat: add veya-mcp CLI entrypoint"

Stage @("src/config.test.ts")
Commit-TreeMsg "test: assert chain defaults and health honesty fields"

Stage @("scripts/smoke.ts")
Commit-TreeMsg "test: add live MCP initialize and tool smoke script"

Stage @("README.md")
Commit-TreeMsg "docs: add publish README for VEYA MCP"

Stage @("docs/README.md","docs/NETWORK_PIN.md","docs/QUICKSTART.md")
Commit-TreeMsg "docs: add docs hub network pins and quickstart"

Stage @("docs/ARCHITECTURE.md","docs/TOOLS.md")
Commit-TreeMsg "docs: document architecture and full tools reference"

Stage @("docs/VERIFICATION.md","docs/DEPLOYMENT.md")
Commit-TreeMsg "docs: add verification procedure and mcp.veyanet.tech deploy guide"

Stage @("docs/CONFIGURATION.md","docs/TRANSPORT.md","docs/AUTHENTICATION.md","docs/SDK_BRIDGE.md")
Commit-TreeMsg "docs: add configuration transport authentication and SDK bridge"

Stage @("SECURITY.md","CHANGELOG.md","CONTRIBUTING.md","LICENSE")
Commit-TreeMsg "docs: add security policy changelog contributing and license"

Stage @("assets/logo.png","package-lock.json")
Commit-TreeMsg "chore: add brand logo and lockfile for reproducible installs"

$left = git status --porcelain
if ($left) {
  Write-Host "LEFT:"
  $left
  git add -A
  # unstage ignored
  git reset HEAD -- node_modules dist 2>$null
  Commit-TreeMsg "chore: include remaining package files"
}

Write-Host "`n=== HISTORY ==="
git log --reverse --format="%h | %an <%ae> | %cn <%ce> | %s"
$hits = git log --format=%B | Select-String "Co-authored-by"
if ($hits) { throw "co-authored-by found" } else { Write-Host "`nco-authored-by: NONE" }
Write-Host ("commit count: {0}" -f (git rev-list --count HEAD))
