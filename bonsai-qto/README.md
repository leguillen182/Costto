# bonsai-qto

Stand-alone Claude Code **skill** for **quantity takeoff (QTO) from IFC models**
with **visual feedback in Blender** — extract quantities, validate them, and
paint the elements in the 3D viewport grouped by category / type / level /
material, then screenshot the result back.

> Self-contained folder: drop it into your skills directory or move it to its own
> repo as-is. It is not wired into any other project.

## How it works

The skill is a **playbook** ([`SKILL.md`](./SKILL.md)) that orchestrates the
**official Blender MCP** (`projects.blender.org/lab/blender_mcp`). It injects two
Python scripts that run *inside* Blender, where the **Bonsai add-on** provides
`ifcopenshell` and the loaded IFC:

| File | Runs where | Does |
|---|---|---|
| [`assets/extract_qto.py`](./assets/extract_qto.py) | inside Blender | reads `Qto_*` psets (geometric fallback), aggregates count/volume/area/length by group, flags missing/zero quantities → JSON |
| [`assets/paint_qto.py`](./assets/paint_qto.py) | inside Blender | colors elements by group via SOLID shading + object color (non-destructive) → legend JSON |

Because all logic lives in injected Python over an *execute-python* tool, the
skill is **transport-portable**: it also runs on `Bonsai_mcp` (which adds ready
IFC tools) by swapping the two tool names — no redesign.

## Requirements

- Blender with the **Bonsai** add-on installed (supplies `ifcopenshell`).
- The **official Blender MCP** server connected (needs an *execute python* tool
  and `get_viewport_screenshot`).
- An IFC model opened in Blender.

## Scope

MVP: classic grouping (category / type / level / material) + screenshot.
Roadmap (see `SKILL.md`): completeness/heatmap coloring, line↔geometry
traceability, and a cost (BC3 / € heatmap) bridge.
