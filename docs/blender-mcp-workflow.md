# Blender MCP Workflow

Local setup paths:

- MCP repo: `C:\Users\Rodion\.codex\mcp\codex_blender_mcp`
- MCP addon zip: `C:\Users\Rodion\.codex\mcp\codex_blender_mcp\codex_blender_mcp_addon.zip`
- Blender addon module: `codex_blender_mcp_bridge`
- Fitting scene: `tools\blender\hoodie-fitting.blend`

The Codex config includes:

- MCP server name: `blender`
- Mode: `addon`
- Addon bridge: `127.0.0.1:9877`

## Start Live Blender Editing

1. Restart Codex so the `blender` MCP server is loaded.
2. Run:

```powershell
powershell -ExecutionPolicy Bypass -File tools\blender\open_hoodie_fitting_scene.ps1
```

3. Blender opens `tools\blender\hoodie-fitting.blend`.
4. The launcher enables `Codex Blender MCP Bridge` and starts the addon server on `127.0.0.1:9877`.
5. In Codex, use Blender MCP tools such as scene info, Python execution, and viewport capture.

If the launcher cannot start the bridge, open Blender manually:

1. `Edit > Preferences > Add-ons`
2. Enable `Codex Blender MCP Bridge`
3. Open `3D View > Sidebar > Codex MCP`
4. Set host `127.0.0.1`, port `9877`
5. Press `Start`

## Regenerate Fitting Scene

```powershell
& "C:\Program Files\Blender Foundation\Blender 5.1\blender.exe" --background --python tools\blender\create_hoodie_fitting_scene.py
```

The `.blend` file is intentionally ignored by git because it is a generated local working scene.
