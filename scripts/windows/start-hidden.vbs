' Starts the LLM usage tracker with no console window. Used by the logon task.
' Output goes to tracker.log in the project folder.
Set sh = CreateObject("WScript.Shell")
root = Replace(WScript.ScriptFullName, "\scripts\windows\start-hidden.vbs", "")
sh.CurrentDirectory = root
sh.Run "cmd /c ""node server.js >> tracker.log 2>&1""", 0, False
