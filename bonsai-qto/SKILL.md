---
name: bonsai-qto
description: >-
  Extract quantity takeoff (QTO) from IFC models and paint the results back into
  the Blender 3D viewport. Driven through the official Blender MCP server with the
  Bonsai add-on as the IFC engine (ifcopenshell). Use when the user wants to
  quantify IFC elements (counts, areas, volumes, lengths), group quantities by
  category / type / level / material, audit a model for missing quantities, or
  color/visualize an IFC model in Blender by any of those groups.
---

# Bonsai QTO — quantity takeoff with visual feedback

Closed-loop QTO for IFC: **extract quantities → validate → paint the model →
screenshot it back**. Unlike spreadsheet-only takeoff tools, the result is a
number *with its picture* — the elements that produced each figure are colored
in the live 3D viewport.

This skill does **not** ship its own IFC engine. It orchestrates the **official
Blender MCP** (`projects.blender.org/lab/blender_mcp`) by injecting Python that
runs inside Blender, where the **Bonsai add-on** provides `ifcopenshell` and the
loaded model. All logic lives in injected Python (the `assets/*.py` files), so
the same skill is **portable to any MCP that exposes an execute-python tool**
(e.g. `Bonsai_mcp`) — only the tool names change.

## Prerequisites (tell the user if any are missing)

1. **Blender** running, with the **Bonsai add-on** installed (formerly
   BlenderBIM). Bonsai is what supplies `ifcopenshell` and the `bonsai.tool` API.
2. The **official Blender MCP** addon + server configured and connected to this
   session. Confirm the connection exposes an *execute python* tool and
   `get_viewport_screenshot` before proceeding.
3. An **IFC model already opened** in Blender (Bonsai → Open IFC Project).

If the IFC isn't loaded, stop and ask the user to open it — the scripts return
`{"error": "No IFC model loaded ..."}` otherwise.

## Tools used (discover exact names from the connected MCP)

- **execute python in Blender** — runs `assets/extract_qto.py` and
  `assets/paint_qto.py`. (On the official server this is the "execute Python in
  the connected Blender instance" tool; on Bonsai_mcp it is `execute_blender_code`.)
- **`get_viewport_screenshot`** — returns the painted viewport as a PNG.

Do not assume tool names: list the connected MCP's tools first and map them to
these two roles.

## Workflow

### 1. Extract quantities
1. Read `assets/extract_qto.py`.
2. Edit its `CONFIG` block: set `GROUP_BY` (`category|type|level|material`) and
   `IFC_CLASS` (`IfcElement` for everything, or a class like `IfcWall`).
3. Send the whole script via the execute-python tool.
4. Parse the JSON between `QTO_JSON_START` / `QTO_JSON_END`.
5. Present a table per group: count, volume, area, length. **Always surface the
   warnings** (`missing_quantity_count`, `zero_quantity_count`) and the per-group
   `from_pset` / `from_geometry` / `no_quantity` split — that split is the
   model's data-quality fingerprint, not a footnote.

### 2. Paint the model (MVP: classic grouping)
1. Read `assets/paint_qto.py`; set the **same** `GROUP_BY` / `IFC_CLASS`.
2. Send it via the execute-python tool; parse the JSON between
   `PAINT_JSON_START` / `PAINT_JSON_END` to get the `legend` (group → RGBA).
3. Call `get_viewport_screenshot` and show the user the painted view, captioned
   with the legend (color → group → quantity from step 1).

### 3. Answer follow-ups
Re-run with a different `GROUP_BY`, narrow `IFC_CLASS`, or filter to a selection.
Each answer = updated table + repainted screenshot.

## Data-reliability rules (do not skip)

- **Quantity source matters.** `Qto_*` psets are authoritative; geometric
  fallback (`from_geometry`) is an estimate. Tell the user which was used and how
  much of the model fell back. A model that's mostly `no_quantity` means the QTO
  is unreliable — say so plainly instead of reporting tidy totals.
- **Units.** Pset quantities use project units; geometric values use the model
  length unit (cubed/squared). Don't sum the two for the same metric without
  noting it. Verify the schema/units when totals look off by orders of magnitude.
- **Double counting.** Aggregated assemblies (`IfcRelAggregates`) can appear
  alongside their parts. If a category total looks inflated, check for
  parent+child duplication before trusting it.
- **Statistical sanity.** Flag elements whose quantity is a large multiple of
  their group mean — usually a modeling error, not a real element.

## Painting notes

- The paint method is SOLID viewport shading + per-object `obj.color`
  (`color_type='OBJECT'`). Reliable and **non-destructive** — it never edits IFC
  materials. To restore the normal look, set viewport shading back to material.
- Alternative if available in the installed Bonsai: the native colour scheme
  (`bpy.ops.bim.colour_by_attribute`). Detect at runtime before relying on it;
  the per-object method above is the safe default and is what the asset uses.

## Risks to manage

1. **Socket fragility.** The Blender MCP talks to Blender over a local TCP
   socket; it can drop. The scripts wrap everything in try/except and always
   print a JSON result (with `error`/`traceback` on failure) so a fault is
   visible, never silent. On a connection error, tell the user to confirm Blender
   + the MCP addon are running, then retry — don't loop blindly.
2. **API namespace.** Recent Bonsai uses `bonsai.tool`; older BlenderBIM used
   `blenderbim.tool`. If `import bonsai.tool` fails, retry the script with
   `blenderbim.tool` and note the version to the user.
3. **Version drift.** Bonsai/Blender update often and can break the addon. Note
   the tested Blender + Bonsai versions when things work, so regressions are
   diagnosable.

## Roadmap (not in this MVP)

- Paint by **data completeness** (green/orange/red = pset / geometry / missing).
- **Heatmap** by value to spot outliers.
- **Line↔geometry traceability**: isolate the elements behind a report row.
- **Cost** bridge (€ heatmap; FIEBDC-3/BC3 export).
