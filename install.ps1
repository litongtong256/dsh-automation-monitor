#!/usr/bin/env pwsh
<#
  install.ps1 —— 把 dsh-automation-monitor 挂进你的 DSH profile

  用法（在本文件所在目录执行）：
      powershell -ExecutionPolicy Bypass -File .\install.ps1
      .\install.ps1 -DshHome "D:\dsh-home" -ProfileName desktop

  干了三件事：
    1. 在 <profile>\node_modules\ 下建一个指向本目录的 junction
    2. 在 <profile>\package.json 的 dependencies 里加一行
    3. 在 dsh.profile.bundles 数组末尾加一行
  改 package.json 前会备份，写坏了会自动还原。

  这个脚本不动任何现有插件，只追加本插件自己的两行。
#>
[CmdletBinding()]
param(
  [string]$DshHome = $env:DSH_HOME,
  [string]$ProfileName = 'desktop'
)

$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$pkgName = 'dsh-automation-monitor'

function Info($m) { Write-Host "  · $m" -ForegroundColor Cyan }
function Good($m) { Write-Host "  ✓ $m" -ForegroundColor Green }
function Bad($m) { Write-Host "  ✗ $m" -ForegroundColor Red }

function Find-DshHome {
  if ($DshHome) { return $DshHome }
  $guess = @(
    (Join-Path $env:USERPROFILE '.dsh'),
    (Join-Path $env:USERPROFILE 'dsh-home'),
    'E:\dsh-home',
    'D:\dsh-home'
  ) | Where-Object { $_ -and (Test-Path $_) }
  return ($guess | Select-Object -First 1)
}

Write-Host "`n$pkgName 安装器`n" -ForegroundColor White

# ---------- 1. 找 DSH_HOME ----------
$DshHome = Find-DshHome
if (-not $DshHome) {
  Bad '没找到 DSH_HOME。'
  Info '先看一眼你 DSH 的数据目录在哪，然后手动指定：'
  Info '  .\install.ps1 -DshHome "C:\Users\你的名字\.dsh"'
  exit 1
}
if (-not (Test-Path $DshHome)) { Bad "DSH_HOME 不存在：$DshHome"; exit 1 }
Good "DSH_HOME = $DshHome"

# ---------- 2. 找 profile ----------
$profilesRoot = Join-Path $DshHome 'profiles'
if (-not (Test-Path $profilesRoot)) { Bad "找不到 profiles 目录：$profilesRoot"; exit 1 }

$profileDir = Join-Path $profilesRoot $ProfileName
if (-not (Test-Path $profileDir)) {
  Bad "没有叫 $ProfileName 的 profile。现有的有："
  Get-ChildItem $profilesRoot -Directory | ForEach-Object { Info $_.Name }
  Info "用 -ProfileName <名字> 指定一个"
  exit 1
}
$pkgPath = Join-Path $profileDir 'package.json'
if (-not (Test-Path $pkgPath)) { Bad "profile 里没有 package.json：$pkgPath"; exit 1 }
Good "profile = $profileDir"

# ---------- 3. 建 junction ----------
$nodeModules = Join-Path $profileDir 'node_modules'
if (-not (Test-Path $nodeModules)) { New-Item -ItemType Directory -Path $nodeModules | Out-Null }
$link = Join-Path $nodeModules $pkgName

if (Test-Path $link) {
  Info '已经有一个同名链接/目录了，先删掉（只删链接本身，不动源码）'
  try { (Get-Item $link -Force).Delete() }
  catch { Bad "删不掉旧的：$link —— 请在资源管理器里手动删掉后重试"; exit 1 }
}
New-Item -ItemType Junction -Path $link -Target $here | Out-Null
Good "链接建好了：$link  ->  $here"

# ---------- 4. 改 package.json ----------
$version = '0.2.0'
$ownPkg = Join-Path $here 'package.json'
if (Test-Path $ownPkg) {
  try { $version = (Get-Content $ownPkg -Raw | ConvertFrom-Json).version } catch {}
}

$bak = "$pkgPath.bak-$pkgName"
Copy-Item $pkgPath $bak -Force
Info "已备份原配置：$bak"

# 优先用 node 改（输出是标准的 2 空格缩进）；没有 node 才退回 PowerShell
$nodeExe = $null
$cand = @(
  (Join-Path $DshHome 'dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe'),
  (Join-Path $DshHome 'dsh-runtimes\dsh-primary-runtime\dependencies\node\node.exe')
) | Where-Object { $_ -and (Test-Path $_) }
if ($cand) { $nodeExe = $cand | Select-Object -First 1 }
if (-not $nodeExe) {
  $g = Get-Command node -ErrorAction SilentlyContinue
  if ($g) { $nodeExe = $g.Source }
}

try {
  if ($nodeExe) {
    $js = @'
const fs = require('fs')
const [p, name, ver] = process.argv.slice(2)
let txt = fs.readFileSync(p, 'utf8')
const bom = txt.charCodeAt(0) === 0xFEFF          // 有的编辑器会带 BOM，先剥掉
if (bom) txt = txt.slice(1)
const j = JSON.parse(txt)
j.dependencies = j.dependencies || {}
j.dependencies[name] = ver
j.dsh = j.dsh || {}
j.dsh.profile = j.dsh.profile || {}
const b = Array.isArray(j.dsh.profile.bundles) ? j.dsh.profile.bundles : []
if (!b.includes(name)) b.push(name)
j.dsh.profile.bundles = b
fs.writeFileSync(p, (bom ? '\uFEFF' : '') + JSON.stringify(j, null, 2) + '\n', 'utf8')
'@
    $jsPath = Join-Path $env:TEMP "dam-patch-$PID.js"
    Set-Content -Path $jsPath -Value $js -Encoding UTF8
    & $nodeExe $jsPath $pkgPath $pkgName $version
    if ($LASTEXITCODE -ne 0) { throw "node 改配置失败（exit $LASTEXITCODE）" }
    Remove-Item $jsPath -Force -ErrorAction SilentlyContinue
    Info '用 node 写入，保持标准缩进'
  }
  else {
    $raw = Get-Content $pkgPath -Raw -Encoding UTF8
    if ($raw -and $raw[0] -eq [char]0xFEFF) { $raw = $raw.Substring(1) }
    $pkg = $raw | ConvertFrom-Json

    if (-not $pkg.PSObject.Properties.Name.Contains('dependencies')) {
      $pkg | Add-Member -NotePropertyName dependencies -NotePropertyValue ([pscustomobject]@{})
    }
    if ($pkg.dependencies.PSObject.Properties.Name.Contains($pkgName)) {
      $pkg.dependencies.$pkgName = $version
    }
    else {
      $pkg.dependencies | Add-Member -NotePropertyName $pkgName -NotePropertyValue $version
    }

    $bundles = @($pkg.dsh.profile.bundles) | Where-Object { $_ }
    if ($bundles -notcontains $pkgName) { $bundles = @($bundles) + $pkgName }
    if ($pkg.dsh.profile.PSObject.Properties.Name.Contains('bundles')) {
      $pkg.dsh.profile.bundles = @($bundles)
    }
    else {
      $pkg.dsh.profile | Add-Member -NotePropertyName bundles -NotePropertyValue @($bundles)
    }

    $pkg | ConvertTo-Json -Depth 40 | Set-Content $pkgPath -Encoding UTF8
    Info '没找到 node，用 PowerShell 写入（格式会朴素一点，不影响使用）'
  }

  # 校验写出来的还是合法 JSON，且确实读得到自己
  $rawCheck = Get-Content $pkgPath -Raw -Encoding UTF8
  if ($rawCheck -and $rawCheck[0] -eq [char]0xFEFF) { $rawCheck = $rawCheck.Substring(1) }
  $check = $rawCheck | ConvertFrom-Json
  if ($check.dsh.profile.bundles -notcontains $pkgName) { throw '写进去的 bundles 里找不到自己' }
  if (-not $check.dependencies.PSObject.Properties.Name.Contains($pkgName)) { throw '写进去的 dependencies 里找不到自己' }
}
catch {
  Copy-Item $bak $pkgPath -Force
  Bad "改 package.json 失败，已还原原文件：$($_.Exception.Message)"
  exit 1
}
Good "dependencies 里加了 $pkgName@$version"
Good "bundles 末尾加了 $pkgName"

Write-Host "`n装好了。重启 DSH，会话头部会多一个「自动化」标签页。`n" -ForegroundColor Green
Write-Host "  改坏了想还原：Copy-Item '$bak' '$pkgPath' -Force" -ForegroundColor DarkGray
Write-Host "  想卸载：删掉 '$link'，再把 package.json 里那两行删掉`n" -ForegroundColor DarkGray
