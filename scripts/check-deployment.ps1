param(
  [string]$CheckerHost = "egp-check.aiy.kdns.fr"
)

$ErrorActionPreference = "Stop"
function Test-Url([string]$Url) {
  try {
    $r = Invoke-WebRequest -Uri $Url -Method Get -TimeoutSec 30 -UseBasicParsing
    [PSCustomObject]@{ Url = $Url; Status = $r.StatusCode; Body = $r.Content.Substring(0, [Math]::Min(300, $r.Content.Length)) }
  } catch {
    [PSCustomObject]@{ Url = $Url; Status = "ERROR"; Body = $_.Exception.Message }
  }
}

@(
  Test-Url "https://$CheckerHost/healthz"
  Test-Url "https://$CheckerHost/admin"
  Test-Url "https://$CheckerHost/login"
) | Format-Table -AutoSize -Wrap
