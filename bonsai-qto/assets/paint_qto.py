"""
bonsai-qto :: paint_qto.py

Run INSIDE Blender via the official Blender MCP "execute python" tool.
Colors IFC elements in the 3D viewport, grouped by a chosen field.

Method: SOLID viewport shading + per-object color. This is reliable and
NON-DESTRUCTIVE — it never touches IFC materials, so nothing is corrupted and
the original look returns by switching shading back. (obj.color is honored
directly in SOLID shading when color_type = 'OBJECT', which avoids the
"object color not visible" trap of Material Preview / Rendered modes.)

After running this, call the MCP get_viewport_screenshot tool to return the
painted view to the user. Use the "legend" in the result to caption it.
"""

# ── CONFIG ── edit these before sending ───────────────────────────────────
GROUP_BY = "category"      # category | type | level | material
IFC_CLASS = "IfcElement"   # restrict scope: e.g. IfcWall, IfcSlab ... IfcElement = all physical elements
# ───────────────────────────────────────────────────────────────────────────

import colorsys
import json
import traceback


def _color_for(i, n):
    """Evenly spaced hues — distinct colors per group."""
    r, g, b = colorsys.hsv_to_rgb(i / max(n, 1), 0.65, 0.95)
    return (r, g, b, 1.0)


def _group_key(el, ue):
    if GROUP_BY == "type":
        t = ue.get_type(el)
        return (t.Name if t and getattr(t, "Name", None) else getattr(el, "ObjectType", None)) or "Untyped"
    if GROUP_BY == "level":
        c = ue.get_container(el)
        return c.Name if c and getattr(c, "Name", None) else "No level"
    if GROUP_BY == "material":
        m = ue.get_material(el)
        return getattr(m, "Name", None) or (m.__class__.__name__ if m else "No material")
    return el.is_a()  # default: category


def main():
    import bpy
    import bonsai.tool as tool
    import ifcopenshell.util.element as ue

    ifc = tool.Ifc.get()
    if ifc is None:
        return {"error": "No IFC model loaded in Bonsai."}

    elements = [e for e in ifc.by_type(IFC_CLASS) if getattr(e, "GlobalId", None)]
    keys = sorted({str(_group_key(e, ue)) for e in elements})
    palette = {k: _color_for(i, len(keys)) for i, k in enumerate(keys)}

    painted = 0
    for el in elements:
        obj = tool.Ifc.get_object(el)
        if obj is None:
            continue
        obj.color = palette[str(_group_key(el, ue))]
        painted += 1

    # Switch every 3D viewport to SOLID shading driven by object color.
    for area in bpy.context.screen.areas:
        if area.type == "VIEW_3D":
            for space in area.spaces:
                if space.type == "VIEW_3D":
                    space.shading.type = "SOLID"
                    space.shading.color_type = "OBJECT"

    return {
        "group_by": GROUP_BY,
        "ifc_class": IFC_CLASS,
        "groups_painted": len(keys),
        "elements_painted": painted,
        "legend": {k: [round(c, 3) for c in palette[k]] for k in keys},
    }


try:
    result = main()
except Exception as e:
    result = {"error": str(e), "traceback": traceback.format_exc()}

print("PAINT_JSON_START")
print(json.dumps(result, indent=2, default=str))
print("PAINT_JSON_END")
