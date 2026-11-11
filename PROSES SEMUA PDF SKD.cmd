@echo off
if not "%~1"=="" goto :selection
"%~dp0JALANKAN PARSER SKD.cmd" --semua

:selection
"%~dp0JALANKAN PARSER SKD.cmd" %*
