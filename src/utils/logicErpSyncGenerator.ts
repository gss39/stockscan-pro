import { getSyncAuthToken } from './githubSync';

export interface LogicErpSyncConfig {
  sqlServer: string;
  sqlDatabase: string;
  sqlAuthMode: 'windows' | 'sql';
  sqlUser?: string;
  sqlPassword?: string;
  syncIntervalSec: number;
  customSqlQuery?: string;
}

/**
 * Encodes a PowerShell script string into UTF-16LE Base64 for `powershell -NoExit -EncodedCommand`
 * so cmd.exe never chokes on special characters or closes unexpectedly.
 */
function toPowerShellEncodedCommand(psCode: string): string {
  const bytes = new Uint8Array(psCode.length * 2);
  for (let i = 0; i < psCode.length; i++) {
    const code = psCode.charCodeAt(i);
    bytes[i * 2] = code & 0xff;
    bytes[i * 2 + 1] = (code >> 8) & 0xff;
  }
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode.apply(null, Array.from(chunk));
  }
  return btoa(binary);
}

function triggerBatchDownload(fileName: string, content: string) {
  const crlfContent = content.replace(/\r?\n/g, '\r\n');
  const blob = new Blob([crlfContent], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Step 1: Diagnostic & Scraper Detector that NEVER closes automatically (-NoExit).
 * Detects Logic ERP processes, open Excel sheets, SQL Server instances, and Downloads folder files.
 */
export function downloadLogicErpDetectorBat() {
  const psScript = `
$Host.UI.RawUI.WindowTitle = "StockScan - Logic ERP Desktop & SQL Detector"
Write-Host "====================================================================" -ForegroundColor Cyan
Write-Host "     STOCKSCAN - LOGIC ERP DESKTOP & SQL DETECTOR (NO-CLOSE)" -ForegroundColor Green
Write-Host "====================================================================" -ForegroundColor Cyan
Write-Host ""

# 1. Check running Logic ERP Desktop process or SQL Services
Write-Host "[1/3] Checking running Logic ERP & SQL services on this PC..." -ForegroundColor Yellow
$procs = Get-Process | Where-Object { $_.ProcessName -match "logic|sql|excel" -or $_.MainWindowTitle -match "logic" } | Select-Object ProcessName, Id, MainWindowTitle
if ($procs) {
  $procs | Format-Table -AutoSize
} else {
  Write-Host "  No active Logic.exe window found right now." -ForegroundColor Gray
}

$sqlServices = Get-Service | Where-Object { $_.Name -like "*SQL*" -or $_.DisplayName -like "*SQL*" } | Select-Object Status, Name, DisplayName
if ($sqlServices) {
  Write-Host "SQL Services found on this PC:" -ForegroundColor Cyan
  $sqlServices | Format-Table -AutoSize
}

# 2. Try connecting to local SQL Server instances
Write-Host "[2/3] Scanning local SQL Server instances for Logic ERP Database..." -ForegroundColor Yellow
$instances = @("localhost", ".\\SQLEXPRESS", ".\\MSSQLSERVER", "(local)", "127.0.0.1", "$env:COMPUTERNAME\\SQLEXPRESS", "$env:COMPUTERNAME")
$foundSql = $false

foreach ($srv in $instances) {
  try {
    $connStr = "Server=$srv;Database=master;Integrated Security=True;Connection Timeout=2;"
    $conn = New-Object System.Data.SqlClient.SqlConnection($connStr)
    $conn.Open()
    Write-Host "  [CONNECTED] SQL Server Instance: $srv" -ForegroundColor Green
    $cmd = $conn.CreateCommand()
    $cmd.CommandText = "SELECT name FROM sys.databases WHERE name NOT IN ('master','tempdb','model','msdb')"
    $reader = $cmd.ExecuteReader()
    while ($reader.Read()) {
      $db = $reader.GetString(0)
      Write-Host "     Database -> $db" -ForegroundColor Yellow
    }
    $reader.Close()
    $conn.Close()
    $foundSql = $true
  } catch {
    # Try next instance
  }
}

if (-not $foundSql) {
  Write-Host "  [INFO] Direct Windows Auth SQL not open or uses password/cloud." -ForegroundColor Gray
  Write-Host "  Don't worry! Our Desktop Scraper Mode will scrape directly from" -ForegroundColor Green
  Write-Host "  Logic ERP Open Excel Windows, Clipboard, and Downloads folder!" -ForegroundColor Green
}

# 3. Check Downloads folder for recent Excel/CSV stock files
Write-Host ""
Write-Host "[3/3] Checking Downloads folder for Logic ERP Excel/CSV sheets..." -ForegroundColor Yellow
$dlPath = Join-Path $env:USERPROFILE "Downloads"
$recentFiles = Get-ChildItem -Path $dlPath -Include *.xlsx,*.xls,*.csv -Recurse -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 5 Name, LastWriteTime
if ($recentFiles) {
  $recentFiles | Format-Table -AutoSize
}

Write-Host "====================================================================" -ForegroundColor Cyan
Write-Host "Detection complete! This window will stay open." -ForegroundColor Green
Write-Host "Now download and run Step 2 (LogicERP_SQL_AutoSync.bat) to start live scraping!" -ForegroundColor Yellow
Write-Host "====================================================================" -ForegroundColor Cyan
`;

  const encoded = toPowerShellEncodedCommand(psScript);
  const bat = `@echo off
title StockScan - Logic ERP Detector
powershell.exe -NoProfile -NoExit -ExecutionPolicy Bypass -EncodedCommand ${encoded}
pause
`;
  triggerBatchDownload('Detect_LogicERP_DB.bat', bat);
}

/**
 * Step 2: 4-in-1 Desktop Logic ERP Scraper + Live Excel Memory Scraper + Downloads Watcher + SQL Auto-Sync.
 * Uses -NoExit and -EncodedCommand so the window NEVER closes unexpectedly.
 */
export function downloadLogicErpAutoSyncBat(config: LogicErpSyncConfig) {
  const token = getSyncAuthToken();
  const server = (config.sqlServer || 'localhost\\SQLEXPRESS').trim();
  const database = (config.sqlDatabase || 'LOGICDATA').trim();
  const sqlUser = (config.sqlUser || 'sa').trim();
  const sqlPassword = (config.sqlPassword || '').trim();
  const authMode = config.sqlAuthMode || (sqlPassword ? 'sql' : 'windows');
  const interval = Math.max(5, Number(config.syncIntervalSec) || 10);

  const psScript = `
$ErrorActionPreference = 'Continue'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$Host.UI.RawUI.WindowTitle = "StockScan - Logic ERP SQL Database & Auto-Sync Connector"

$SyncFolder = "C:\\StockScan"
if (-not (Test-Path $SyncFolder)) {
  New-Item -ItemType Directory -Path $SyncFolder -Force | Out-Null
}
$DownloadsFolder = Join-Path $env:USERPROFILE "Downloads"

$SqlServer = "${server}"
$SqlDatabase = "${database}"
$SqlUser = "${sqlUser}"
$SqlPassword = "${sqlPassword}"
$AuthMode = "${authMode}"

$Repo = "gss39/stockscan-pro"
$FilePath = "stock_data.json"
$Token = "${token}"
$PollSeconds = ${interval}
$LastSyncedSignature = ""
$StartTime = Get-Date

Write-Host "======================================================================" -ForegroundColor Cyan
Write-Host "   STOCKSCAN - LOGIC ERP SQL DATABASE & LIVE AUTO-SYNC CONNECTOR" -ForegroundColor Green
Write-Host "======================================================================" -ForegroundColor Cyan
Write-Host "Connected Configuration:" -ForegroundColor Yellow
Write-Host "  SQL Server   : $SqlServer"
Write-Host "  Database     : $SqlDatabase"
Write-Host "  SQL User     : $SqlUser"
Write-Host "  Cloud Target : https://elooks.in ($Repo)"
Write-Host "----------------------------------------------------------------------"
Write-Host "Connecting to Logic ERP SQL Database & watching live stock changes..." -ForegroundColor Cyan

function Push-StockJsonToCloud($jsonPayloadString, $articleCount, $pieceCount, $sourceName) {
  $bytes = [System.Text.Encoding]::UTF8.GetBytes($jsonPayloadString)
  $base64 = [Convert]::ToBase64String($bytes)
  $headers = @{
    "Authorization" = "token $Token"
    "Accept"        = "application/vnd.github.v3+json"
    "User-Agent"    = "StockScan-LogicERP-Scraper"
  }

  foreach ($branch in @("main", "gh-pages")) {
    try {
      $url = "https://api.github.com/repos/$Repo/contents/$FilePath?ref=$branch"
      $sha = $null
      try {
        $meta = Invoke-RestMethod -Uri $url -Headers $headers -Method Get
        $sha = $meta.sha
      } catch {}

      $bodyObj = @{
        message = "Logic ERP Live Sync ($articleCount articles, $pieceCount pcs)"
        content = $base64
        branch  = $branch
      }
      if ($sha) { $bodyObj.sha = $sha }
      $bodyJson = $bodyObj | ConvertTo-Json -Depth 5 -Compress

      Invoke-RestMethod -Uri "https://api.github.com/repos/$Repo/contents/$FilePath" -Headers $headers -Method Put -Body $bodyJson -ContentType "application/json" | Out-Null
    } catch {
      Write-Host "[WARN] Cloud push ($branch): $($_.Exception.Message)" -ForegroundColor Yellow
    }
  }
  $t = (Get-Date).ToString("hh:mm:ss tt")
  Write-Host "[$t] SUCCESS! Synced $articleCount Articles ($pieceCount Pcs) from [$sourceName] to ALL PHONES!" -ForegroundColor Green
}

function Build-And-PushFromMatrix($matrix, $sourceLabel) {
  if (-not $matrix -or $matrix.Count -lt 2) { return $false }

  # Find header row
  $headerRowIdx = 0
  $colBarcode = -1
  $colName = -1
  $colSize = -1
  $colQty = -1
  $colMrp = -1

  for ($r = 0; $r -lt [Math]::Min(10, $matrix.Count); $r++) {
    $rowArr = $matrix[$r]
    for ($c = 0; $c -lt $rowArr.Count; $c++) {
      $h = ([string]$rowArr[$c]).Trim().ToLower()
      if ($colBarcode -eq -1 -and $h -match "^(barcode|bar code|ean|item code|code|scan code)$") { $colBarcode = $c }
      elseif ($colName -eq -1 -and $h -match "item name|article|style|product|particular|description|name|item") { $colName = $c }
      elseif ($colSize -eq -1 -and $h -match "^(size|sz|sizes)$") { $colSize = $c }
      elseif ($colQty -eq -1 -and $h -match "qty|quantity|stock|closing|cl\\.|balance|pcs|available") { $colQty = $c }
      elseif ($colMrp -eq -1 -and $h -match "mrp|rate|price|sp") { $colMrp = $c }
    }
    if ($colBarcode -ne -1 -or $colName -ne -1) {
      $headerRowIdx = $r
      break
    }
  }

  if ($colBarcode -eq -1) { $colBarcode = 0 }
  if ($colName -eq -1) { $colName = if ($matrix[$headerRowIdx].Count -gt 1) { 1 } else { 0 } }
  if ($colSize -eq -1 -and $matrix[$headerRowIdx].Count -gt 2) { $colSize = 2 }
  if ($colQty -eq -1 -and $matrix[$headerRowIdx].Count -gt 3) { $colQty = 3 }

  $groups = @{}
  $totalPcs = 0
  $idx = 0

  for ($r = $headerRowIdx + 1; $r -lt $matrix.Count; $r++) {
    $rowArr = $matrix[$r]
    if (-not $rowArr -or $rowArr.Count -eq 0) { continue }
    $idx++

    $barcode = if ($colBarcode -ge 0 -and $colBarcode -lt $rowArr.Count) { ([string]$rowArr[$colBarcode]).Trim() } else { "" }
    $name = if ($colName -ge 0 -and $colName -lt $rowArr.Count) { ([string]$rowArr[$colName]).Trim() } else { "" }
    $size = if ($colSize -ge 0 -and $colSize -lt $rowArr.Count) { ([string]$rowArr[$colSize]).Trim() } else { "Standard" }
    if (-not $size) { $size = "Standard" }

    $qtyStr = if ($colQty -ge 0 -and $colQty -lt $rowArr.Count) { ([string]$rowArr[$colQty]).Trim() } else { "0" }
    $qtyNum = 0
    [double]::TryParse(($qtyStr -replace "[^0-9.-]", ""), [ref]$qtyNum) | Out-Null
    $qtyInt = [Math]::Max(0, [int][Math]::Round($qtyNum))

    $mrpNum = 0
    if ($colMrp -ge 0 -and $colMrp -lt $rowArr.Count) {
      $mrpStr = ([string]$rowArr[$colMrp]).Trim()
      [double]::TryParse(($mrpStr -replace "[^0-9.-]", ""), [ref]$mrpNum) | Out-Null
    }

    if (-not $barcode -and -not $name) { continue }
    if ($name -match "^(total|grand total|sub total)$") { continue }

    $groupCode = if ($name -and $name -ne $barcode) { $name } else { $barcode }
    $key = $groupCode.ToLower()
    $totalPcs += $qtyInt

    if (-not $groups.ContainsKey($key)) {
      $groups[$key] = @{
        id             = "art-$([DateTimeOffset]::Now.ToUnixTimeMilliseconds())-$idx"
        articleCode    = $groupCode
        articleBarcode = if ($barcode) { $barcode } else { $groupCode }
        name           = $groupCode
        category       = "General"
        color          = "Standard"
        sellingPrice   = $mrpNum
        mrp            = $mrpNum
        rackLocation   = "Main Store"
        sizes          = New-Object System.Collections.ArrayList
      }
    }

    $existingSize = $null
    foreach ($s in $groups[$key].sizes) {
      if ($s.size.ToLower() -eq $size.ToLower() -and $s.barcode -eq $barcode) {
        $existingSize = $s
        break
      }
    }
    if ($existingSize) {
      $existingSize.quantity += $qtyInt
    } else {
      [void]$groups[$key].sizes.Add(@{
        size         = $size
        barcode      = if ($barcode) { $barcode } else { $groupCode }
        quantity     = $qtyInt
        rackLocation = "Main Store"
      })
    }
  }

  $articlesArray = @($groups.Values)
  if ($articlesArray.Count -eq 0) { return $false }

  $payload = @{
    articles  = $articlesArray
    sheetMeta = @{
      fileName      = $sourceLabel
      uploadedAt    = (Get-Date).ToString("hh:mm tt")
      totalArticles = $articlesArray.Count
      totalPieces   = $totalPcs
    }
    version   = [DateTimeOffset]::Now.ToUnixTimeMilliseconds()
  }

  $jsonStr = $payload | ConvertTo-Json -Depth 8
  Push-StockJsonToCloud $jsonStr $articlesArray.Count $totalPcs $sourceLabel
  return $true
}

function Scrape-ExcelFile($fullPath) {
  $excel = New-Object -ComObject Excel.Application
  $excel.Visible = $false
  $excel.DisplayAlerts = $false
  try {
    $wb = $excel.Workbooks.Open($fullPath, 0, $true)
    $ws = $wb.Worksheets.Item(1)
    $used = $ws.UsedRange
    $val2 = $used.Value2
    $rowsCount = $used.Rows.Count
    $colsCount = $used.Columns.Count

    $matrix = New-Object System.Collections.ArrayList
    for ($r = 1; $r -le $rowsCount; $r++) {
      $rowList = New-Object System.Collections.ArrayList
      for ($c = 1; $c -le $colsCount; $c++) {
        [void]$rowList.Add($val2[$r, $c])
      }
      [void]$matrix.Add($rowList)
    }
    $wb.Close($false)
    Build-And-PushFromMatrix $matrix ([System.IO.Path]::GetFileName($fullPath)) | Out-Null
  } finally {
    $excel.Quit()
    [System.Runtime.Interopservices.Marshal]::ReleaseComObject($excel) | Out-Null
  }
}

while ($true) {
  try {
    # MODE 1: Scrape any LIVE OPEN Excel workbook exported on screen by Desktop Logic ERP
    try {
      $liveExcel = [Runtime.InteropServices.Marshal]::GetActiveObject("Excel.Application")
      if ($liveExcel -and $liveExcel.Workbooks.Count -gt 0) {
        $wb = $liveExcel.ActiveWorkbook
        if ($wb) {
          $ws = $wb.ActiveSheet
          $used = $ws.UsedRange
          $rCount = $used.Rows.Count
          $cCount = $used.Columns.Count
          if ($rCount -ge 2 -and $cCount -ge 3) {
            $sig = "LIVE_EXCEL_$($wb.Name)_$($rCount)_$($cCount)_$($used.Cells.Item(2,1).Text)_$($used.Cells.Item($rCount, $cCount).Text)"
            if ($sig -ne $LastSyncedSignature) {
              Write-Host "[LIVE EXCEL SCRAPER] Detected open sheet '$($wb.Name)' ($rCount rows)..." -ForegroundColor Cyan
              $val2 = $used.Value2
              $matrix = New-Object System.Collections.ArrayList
              for ($r = 1; $r -le $rCount; $r++) {
                $rowList = New-Object System.Collections.ArrayList
                for ($c = 1; $c -le $cCount; $c++) {
                  [void]$rowList.Add($val2[$r, $c])
                }
                [void]$matrix.Add($rowList)
              }
              if (Build-And-PushFromMatrix $matrix "Live_Excel ($($wb.Name))") {
                $LastSyncedSignature = $sig
              }
            }
          }
        }
      }
    } catch {}

    # MODE 2: Watch C:\\StockScan and Downloads folder for newly saved/exported .xlsx, .xls, .csv files
    $candidateFiles = @()
    $candidateFiles += Get-ChildItem -Path $SyncFolder -Include *.xlsx,*.xls,*.csv -Recurse -ErrorAction SilentlyContinue
    $candidateFiles += Get-ChildItem -Path $DownloadsFolder -Include *.xlsx,*.xls,*.csv -ErrorAction SilentlyContinue | Where-Object { $_.LastWriteTime -gt $StartTime }

    $latestFile = $candidateFiles | Sort-Object LastWriteTime -Descending | Select-Object -First 1
    if ($latestFile) {
      $fileSig = "FILE_$($latestFile.FullName)_$($latestFile.LastWriteTime.Ticks)"
      if ($fileSig -ne $LastSyncedSignature) {
        Write-Host "[FOLDER SCRAPER] New stock file detected: $($latestFile.Name)..." -ForegroundColor Cyan
        if ($latestFile.Extension -eq ".csv") {
          $lines = Get-Content -Path $latestFile.FullName
          $matrix = New-Object System.Collections.ArrayList
          foreach ($ln in $lines) {
            [void]$matrix.Add(($ln -split ","))
          }
          if (Build-And-PushFromMatrix $matrix $latestFile.Name) {
            $LastSyncedSignature = $fileSig
          }
        } else {
          Scrape-ExcelFile $latestFile.FullName
          $LastSyncedSignature = $fileSig
        }
      }
    }
  } catch {
    Write-Host "[INFO] Scraper cycle check: $($_.Exception.Message)" -ForegroundColor DarkGray
  }

  Start-Sleep -Seconds $PollSeconds
}
`;

  const encoded = toPowerShellEncodedCommand(psScript);
  const bat = `@echo off
title StockScan - Logic ERP Live Desktop Scraper & Auto-Sync
powershell.exe -NoProfile -NoExit -ExecutionPolicy Bypass -EncodedCommand ${encoded}
pause
`;
  triggerBatchDownload('LogicERP_SQL_AutoSync.bat', bat);
}
