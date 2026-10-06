@echo off
rem Registers "Door Daemon" to start (minimised) 1 minute after Windows logon. Run once.
schtasks /create /tn "Door Daemon" /tr "cmd /c start \"DoorDaemon\" /min C:\Users\Redmyre\Desktop\HVAC_Auto\start_door.bat" /sc onlogon /delay 0001:00 /f
schtasks /query /tn "Door Daemon"
pause
