param([string]$Spec, [string]$Old, [string]$Out)
# Aplica specificatia JSON (build-spec.cjs) intr-un workbook nou, prin Excel COM. Doar ASCII in acest fisier.
$ErrorActionPreference = 'Stop'
$json = Get-Content -Raw -Encoding UTF8 $Spec | ConvertFrom-Json
$M = [Type]::Missing

function BGR([string]$hex) {
  $h = $hex.TrimStart('#')
  $r = [Convert]::ToInt32($h.Substring(0, 2), 16); $g = [Convert]::ToInt32($h.Substring(2, 2), 16); $b = [Convert]::ToInt32($h.Substring(4, 2), 16)
  return [int]($r + 256 * $g + 65536 * $b)
}
function Val($v) { if ($v -is [decimal]) { return [double]$v } ; if ($v -is [long]) { return [double]$v } ; return $v }

$xl = New-Object -ComObject Excel.Application
$xl.Visible = $false; $xl.DisplayAlerts = $false; $xl.ScreenUpdating = $false
$i = 0
try {
  $wb = $xl.Workbooks.Add()
  while ($wb.Worksheets.Count -gt 1) { $wb.Worksheets.Item($wb.Worksheets.Count).Delete() }
  $xl.Calculation = -4135
  $wb.Styles.Item('Normal').Font.Name = 'Arial'
  $wb.Styles.Item('Normal').Font.Size = 10
  foreach ($o in $json.ops) {
    $i++
    try {
      switch ($o.op) {
        'sheets' {
          $first = $true
          foreach ($n in $o.names) {
            if ($first) { $wb.Worksheets.Item(1).Name = $n; $first = $false }
            else { $ws = $wb.Worksheets.Add($M, $wb.Worksheets.Item($wb.Worksheets.Count)); $ws.Name = $n }
          }
        }
        'copySheet' {
          $ow = $xl.Workbooks.Open($Old, 0, $true)
          $ow.Worksheets.Item($o.name).Copy($M, $wb.Worksheets.Item($o.after))
          $ow.Close($false)
        }
        'name' { [void]$wb.Names.Add($o.n, $o.ref) }
        'set' {
          $r = $wb.Worksheets.Item($o.s).Range($o.r)
          # call site separat pe tip: binderul COM din PowerShell retine tipul primei atribuiri
          if ($null -eq $o.v) { [void]$r.ClearContents() }
          elseif ($o.v -is [string]) { $r.Value2 = [string]$o.v }
          else { $r.Value2 = [double]$o.v }
        }
        'f' { $wb.Worksheets.Item($o.s).Range($o.r).Formula = $o.f }
        'fmt' {
          $r = $wb.Worksheets.Item($o.s).Range($o.r)
          if ($o.nf) { $r.NumberFormat = $o.nf }
          if ($o.fill) { $r.Interior.Color = (BGR $o.fill) }
          if ($o.color) { $r.Font.Color = (BGR $o.color) }
          if ($null -ne $o.bold) { $r.Font.Bold = [bool]$o.bold }
          if ($o.size) { $r.Font.Size = [double]$o.size }
          if ($null -ne $o.wrap) { $r.WrapText = [bool]$o.wrap }
          if ($o.h) { $r.HorizontalAlignment = @{ left = -4131; center = -4108; right = -4152 }[$o.h] }
          if ($o.v) { $r.VerticalAlignment = @{ top = -4160; center = -4108 }[$o.v] }
          if ($o.border) { $b = $r.Borders; $b.LineStyle = 1; $b.Weight = 2; $b.Color = (BGR '#BFBFBF') }
        }
        'width' { $wb.Worksheets.Item($o.s).Range($o.cols.Split(':')[0] + ':' + $o.cols.Split(':')[-1]).ColumnWidth = [double]$o.w }
        'height' { $wb.Worksheets.Item($o.s).Rows.Item([int]$o.row).RowHeight = [double]$o.h }
        'merge' { $wb.Worksheets.Item($o.s).Range($o.r).Merge() }
        'valid' {
          $r = $wb.Worksheets.Item($o.s).Range($o.r)
          $r.Validation.Delete()
          [void]$r.Validation.Add(3, 1, 1, $o.list)
          $r.Validation.IgnoreBlank = $true; $r.Validation.InCellDropdown = $true
        }
        'cf' {
          $r = $wb.Worksheets.Item($o.s).Range($o.r)
          if ($o.type -eq 'expr') { $fc = $r.FormatConditions.Add(2, $M, $o.f1) }
          elseif ($o.type -eq 'text') { $fc = $r.FormatConditions.Add(9, $M, $M, $M, $o.text, 0) }
          elseif ($o.f2) { $fc = $r.FormatConditions.Add(1, [int]$o.oper, $o.f1, $o.f2) }
          else { $fc = $r.FormatConditions.Add(1, [int]$o.oper, $o.f1) }
          if ($o.fill) { $fc.Interior.Color = (BGR $o.fill) }
          if ($o.color) { $fc.Font.Color = (BGR $o.color) }
          if ($o.bold) { $fc.Font.Bold = $true }
        }
        'freeze' {
          $ws = $wb.Worksheets.Item($o.s); $ws.Activate()
          $w = $xl.ActiveWindow; $w.FreezePanes = $false; $w.ScrollRow = 1; $w.ScrollColumn = 1
          $w.SplitRow = [int]$o.row; $w.SplitColumn = [int]$o.col; $w.FreezePanes = $true
        }
        'tab' { $wb.Worksheets.Item($o.s).Tab.Color = (BGR $o.color) }
        'autofit' { [void]$wb.Worksheets.Item($o.s).Range($o.r).Rows.AutoFit() }
        'gridlines' { $wb.Worksheets.Item($o.s).Activate(); $xl.ActiveWindow.DisplayGridlines = [bool]$o.show }
        'activate' { $wb.Worksheets.Item($o.s).Activate(); $xl.ActiveWindow.ScrollRow = 1; $xl.ActiveWindow.ScrollColumn = 1; [void]$wb.Worksheets.Item($o.s).Range('A6').Select() }
        default { throw "op necunoscut: $($o.op)" }
      }
    } catch {
      throw ("Operatia #{0} ({1} {2} {3}): {4}" -f $i, $o.op, $o.s, $o.r, $_.Exception.Message)
    }
  }
  $xl.Calculation = -4105
  $xl.CalculateFull()
  if (Test-Path $Out) { Remove-Item $Out -Force }
  $wb.SaveAs($Out, 51)
  $wb.Close($false)
  "OK: $i operatii, salvat $Out"
} finally {
  $xl.Quit()
  [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($xl)
}
