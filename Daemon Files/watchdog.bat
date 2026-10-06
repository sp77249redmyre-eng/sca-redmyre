@echo off
powershell -NoProfile -Command "$p = Get-CimInstance Win32_Process -Filter \"Name='python.exe'\" | Where-Object { $_.CommandLine -like '*HVAC_daemon_Auto.py*' }; if (-not $p) { Start-Process -FilePath 'C:\Users\Redmyre\Desktop\HVAC_Auto\start_hvac.bat' -WorkingDirectory 'C:\Users\Redmyre\Desktop\HVAC_Auto' }"
