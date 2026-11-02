### Fixed

- Launch the Azure CLI Windows command shim correctly for Dashboard PR status and Run cleanup instead of reporting an installed CLI as missing.
- Recognise a missing Azure CLI on a Windows in any language, by the exit code 9009 of `cmd.exe`.
