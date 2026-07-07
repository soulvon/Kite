<#
.SYNOPSIS
    Kite / windsurf-pool 残留清理脚本

.DESCRIPTION
    当旧版扩展卸载后 workbench.html / extension.js / product.json 仍有补丁残留，
    导致 IDE 白屏或功能异常时，在 IDE 外部执行此脚本一键恢复。

    用法（在终端中运行，可能需要管理员权限）：
      powershell -ExecutionPolicy Bypass -File scripts\cleanup-residue.ps1

    支持自动检测 Windsurf 和 Devin 的安装路径。
#>

$ErrorActionPreference = 'Stop'

# --- 检测 IDE 安装路径 ---
function Find-IdeInstall {
    $candidates = @()

    # Windows: 从注册表查找
    if ($env:OS -eq 'Windows_NT') {
        $regBases = @(
            'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall',
            'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall',
            'HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall'
        )
        $searchTerms = @('Windsurf', 'Devin')
        foreach ($base in $regBases) {
            if (-not (Test-Path $base)) continue
            Get-ChildItem $base -ErrorAction SilentlyContinue | ForEach-Object {
                $props = Get-ItemProperty $_.PSPath -ErrorAction SilentlyContinue
                $displayName = $props.DisplayName
                $installLoc = $props.InstallLocation
                if ($displayName -and $installLoc) {
                    foreach ($term in $searchTerms) {
                        if ($displayName -like "*$term*" -and (Test-Path $installLoc)) {
                            $appPath = Join-Path $installLoc 'resources\app'
                            if (Test-Path $appPath) {
                                $candidates += [PSCustomObject]@{
                                    Name = $term
                                    AppPath = $appPath
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    # Fallback: 常见路径
    $commonPaths = @(
        @{ Name = 'Windsurf'; Path = 'E:\Program\Windsurf\resources\app' },
        @{ Name = 'Windsurf'; Path = 'C:\Program Files\Windsurf\resources\app' },
        @{ Name = 'Windsurf'; Path = "$env:LOCALAPPDATA\Programs\Windsurf\resources\app" },
        @{ Name = 'Devin'; Path = 'E:\Program\Devin\resources\app' },
        @{ Name = 'Devin'; Path = 'C:\Program Files\Devin\resources\app' },
        @{ Name = 'Devin'; Path = "$env:LOCALAPPDATA\Programs\Devin\resources\app" }
    )
    foreach ($cp in $commonPaths) {
        if (Test-Path $cp.Path) {
            $already = $false
            foreach ($c in $candidates) { if ($c.AppPath -eq $cp.Path) { $already = $true; break } }
            if (-not $already) {
                $candidates += [PSCustomObject]@{
                    Name = $cp.Name
                    AppPath = $cp.Path
                }
            }
        }
    }

    return $candidates
}

# --- 恢复文件 ---
function Restore-File {
    param([string]$TargetPath, [string]$Description)

    $restored = $false

    # 优先 .origin
    $originPath = "$TargetPath.origin"
    if (Test-Path $originPath) {
        Copy-Item $originPath $TargetPath -Force
        Write-Host "  [OK] $Description : 已从 .origin 恢复" -ForegroundColor Green
        return $true
    }

    # 查找最新的 .backup_* 文件
    $dir = Split-Path $TargetPath -Parent
    $baseName = Split-Path $TargetPath -Leaf
    $backups = Get-ChildItem $dir -Filter "$baseName.backup_*" -ErrorAction SilentlyContinue |
               Sort-Object Name -Descending |
               Select-Object -First 1
    if ($backups) {
        Copy-Item $backups[0].FullName $TargetPath -Force
        Write-Host "  [OK] $Description : 已从 $($backups[0].Name) 恢复" -ForegroundColor Green
        return $true
    }

    # 查找 .orig
    $origPath = "$TargetPath.orig"
    if (Test-Path $origPath) {
        Copy-Item $origPath $TargetPath -Force
        Write-Host "  [OK] $Description : 已从 .orig 恢复" -ForegroundColor Green
        return $true
    }

    Write-Host "  [SKIP] $Description : 未找到备份文件" -ForegroundColor Yellow
    return $false
}

# --- 检查是否有残留 ---
function Test-HasResidue {
    param([string]$AppPath)

    $hasResidue = $false

    # 检查 workbench.html
    $workbenchPaths = @(
        (Join-Path $AppPath 'out\vs\code\electron-browser\workbench\workbench.html'),
        (Join-Path $AppPath 'out\vs\code\browser\workbench\workbench.html')
    )
    foreach ($wb in $workbenchPaths) {
        if (Test-Path $wb) {
            $content = Get-Content $wb -Raw -ErrorAction SilentlyContinue
            if ($content -match 'ws-better-start|ws-better-end|windsurf-better|devin-better') {
                Write-Host "  [发现] workbench.html 有增强脚本注入残留" -ForegroundColor Red
                $hasResidue = $true
            }
        }
    }

    # 检查 extension.js
    $ideDirs = @('windsurf', 'devin')
    $subDirs = @('dist', 'out')
    foreach ($ide in $ideDirs) {
        foreach ($sub in $subDirs) {
            $extJs = Join-Path $AppPath "extensions\$ide\$sub\extension.js"
            if (Test-Path $extJs) {
                $content = Get-Content $extJs -Raw -ErrorAction SilentlyContinue
                if ($content -match 'handleAuthTokenWithShit|provideAuthTokenToAuthProviderWithShit|exportCurrentSessionWithShit') {
                    Write-Host "  [发现] $ide/$sub/extension.js 有补丁残留" -ForegroundColor Red
                    $hasResidue = $true
                }
            }
        }
    }

    # 检查 product.json
    $productJson = Join-Path $AppPath 'product.json'
    if (Test-Path $productJson) {
        $hasOrigin = Test-Path "$productJson.origin"
        $hasOrig = Test-Path "$productJson.orig"
        if ($hasOrigin -or $hasOrig) {
            Write-Host "  [发现] product.json 有备份（可能被修改过）" -ForegroundColor Yellow
            $hasResidue = $true
        }
    }

    return $hasResidue
}

# --- 主流程 ---
Write-Host ""
Write-Host "=== Kite / windsurf-pool 残留清理工具 ===" -ForegroundColor Cyan
Write-Host ""

$ides = Find-IdeInstall

if ($ides.Count -eq 0) {
    Write-Host "未找到 Windsurf 或 Devin 安装路径" -ForegroundColor Red
    Write-Host "请手动指定安装路径后重试" -ForegroundColor Yellow
    exit 1
}

foreach ($ide in $ides) {
    Write-Host "检查 $($ide.Name) (路径: $($ide.AppPath))" -ForegroundColor Cyan
    Write-Host ""

    $hasResidue = Test-HasResidue -AppPath $ide.AppPath

    if (-not $hasResidue) {
        Write-Host "  [干净] 未发现残留，无需清理" -ForegroundColor Green
        Write-Host ""
        continue
    }

    Write-Host ""
    Write-Host "  正在清理..." -ForegroundColor Cyan

    # 恢复 workbench.html
    $workbenchPaths = @(
        (Join-Path $ide.AppPath 'out\vs\code\electron-browser\workbench\workbench.html'),
        (Join-Path $ide.AppPath 'out\vs\code\browser\workbench\workbench.html')
    )
    foreach ($wb in $workbenchPaths) {
        if (Test-Path $wb) {
            $content = Get-Content $wb -Raw -ErrorAction SilentlyContinue
            if ($content -match 'ws-better-start') {
                Restore-File -TargetPath $wb -Description "workbench.html"
            }
        }
    }

    # 恢复 extension.js
    foreach ($ideDir in @('windsurf', 'devin')) {
        foreach ($sub in @('dist', 'out')) {
            $extJs = Join-Path $ide.AppPath "extensions\$ideDir\$sub\extension.js"
            if (Test-Path $extJs) {
                $content = Get-Content $extJs -Raw -ErrorAction SilentlyContinue
                if ($content -match 'handleAuthTokenWithShit') {
                    Restore-File -TargetPath $extJs -Description "$ideDir/$sub/extension.js"
                }
            }
        }
    }

    # 恢复 product.json
    $productJson = Join-Path $ide.AppPath 'product.json'
    if (Test-Path $productJson) {
        Restore-File -TargetPath $productJson -Description "product.json"
    }

    Write-Host ""
    Write-Host "  清理完成！请重启 $($ide.Name)。" -ForegroundColor Green
    Write-Host ""
}

Write-Host "=== 完成 ===" -ForegroundColor Cyan
