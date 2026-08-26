# PostToolUse hook (Write|Edit): when app.js / admin.js / style.css /
# admin_style.css / srs-utils.js is edited, bump that file's `?v=YYYYMMDD`
# query string in index.html / admin.html to today's date — so mobile
# browsers don't keep serving the stale cached file after deploy.
# (See 반복학습앱_수정개선사항.md section 5 for why this matters.)
#
# If the version already reflects today, it's left untouched (idempotent) —
# no need to re-bump on every edit within the same day.

$in = [Console]::In.ReadToEnd() | ConvertFrom-Json

try {
    $fp = $in.tool_input.file_path
    if (-not $fp) { $fp = $in.tool_response.filePath }
    if (-not $fp) { exit 0 }

    $tracked = @('app.js', 'admin.js', 'style.css', 'admin_style.css', 'srs-utils.js')
    $name = Split-Path $fp -Leaf
    if ($tracked -notcontains $name) { exit 0 }

    $projectRoot = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
    $today = Get-Date -Format 'yyyyMMdd'
    $escName = [regex]::Escape($name)
    $pattern = "($escName\?v=)(\d{8})([a-z]?)"

    # Windows PowerShell 5.1's -Encoding UTF8 always writes a BOM, which these
    # files don't have. Use .NET directly to read/write plain UTF-8 (no BOM),
    # preserving the files exactly as they were otherwise.
    $utf8NoBom = New-Object System.Text.UTF8Encoding($false)

    $changedHtml = @()
    foreach ($htmlName in @('index.html', 'admin.html')) {
        $htmlPath = Join-Path $projectRoot $htmlName
        if (-not (Test-Path $htmlPath)) { continue }

        $content = [System.IO.File]::ReadAllText($htmlPath, $utf8NoBom)
        $newContent = [regex]::Replace($content, $pattern, {
            param($m)
            if ($m.Groups[2].Value -eq $today) { return $m.Value }
            return "$($m.Groups[1].Value)$today"
        })

        if ($newContent -ne $content) {
            [System.IO.File]::WriteAllText($htmlPath, $newContent, $utf8NoBom)
            $changedHtml += $htmlName
        }
    }

    if ($changedHtml.Count -gt 0) {
        $msg = "🔄 캐시버스팅: $name 저장 -> $($changedHtml -join ', ')의 ?v=를 $today 로 갱신"
        (@{ systemMessage = $msg } | ConvertTo-Json -Compress)
    }
} catch {
    # Never let a hook hiccup interrupt the actual tool call.
}

exit 0
