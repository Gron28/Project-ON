# Read-only Windows SMTC metadata; no compiler, package manager, or player controls.
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
try {
  Add-Type -AssemblyName System.Runtime.WindowsRuntime
  $null = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager,Windows.Media.Control,ContentType=WindowsRuntime]
  $null = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties,Windows.Media.Control,ContentType=WindowsRuntime]
  $asTask = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.IsGenericMethod -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' } | Select-Object -First 1
  function Await($operation, $type) {
    $task = $asTask.MakeGenericMethod($type).Invoke($null,@($operation))
    if (-not $task.Wait(3000)) { throw 'Media metadata request timed out' }
    return $task.Result
  }
  $manager = Await ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]::RequestAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager])
  while ($true) {
    $sessions = @()
    foreach ($session in $manager.GetSessions()) {
      try {
        $properties = Await ($session.TryGetMediaPropertiesAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties])
        $timeline = $session.GetTimelineProperties()
        $sessions += @{app=$session.SourceAppUserModelId;title=$properties.Title;artist=$properties.Artist;album=$properties.AlbumTitle;albumArtist=$properties.AlbumArtist;trackId='';status=$session.GetPlaybackInfo().PlaybackStatus.ToString();position=$timeline.Position.TotalSeconds}
      } catch { }
    }
    [Console]::WriteLine((@{sessions=$sessions} | ConvertTo-Json -Compress -Depth 5))
    Start-Sleep -Seconds 2
  }
} catch {
  [Console]::WriteLine((@{sessions=@();error='Windows media metadata unavailable. Use manual song markers.'} | ConvertTo-Json -Compress))
  exit 1
}
