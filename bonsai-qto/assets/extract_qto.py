"""
bonsai-qto :: extract_qto.py

Run INSIDE Blender via the official Blender MCP "execute python" tool.
Requires the Bonsai add-on installed (it provides ifcopenshell and exposes
the IFC model currently loaded in Blender).

What it does:
  - Reads measured quantities from Qto_* property sets (the reliable source).
  - Falls back to geometric computation (ifcopenshell.geom + util.shape) when a
    pset quantity is missing, and flags which source was used.
  - Aggregates count / volume / area / length by a chosen grouping field.
  - Prints a JSON report between QTO_JSON_START / QTO_JSON_END markers so the
    caller can parse it from stdout.

NOTE on units: pset quantities are in the project's units; geometric values are
in the model length unit (cubed/squared). Do not mix sources blindly for totals
of the same metric — the report keeps source counts per group so you can warn.
"""

# ── CONFIG ── edit these before sending ───────────────────────────────────
GROUP_BY = "category"      # category | type | level | material
IFC_CLASS = "IfcElement"   # restrict scope: e.g. IfcWall, IfcSlab ... IfcElement = all physical elements
# ───────────────────────────────────────────────────────────────────────────

import json
import traceback


def _pull_quantities(psets):
    """Pick volume / area / length from Qto_* quantity sets."""
    vol = area = length = None
    for name, props in psets.items():
        if not name.lower().startswith("qto"):
            continue
        for k, v in props.items():
            if not isinstance(v, (int, float)):
                continue
            kl = k.lower()
            if vol is None and "volume" in kl:
                vol = v
            elif area is None and "area" in kl:
                area = v
            elif length is None and ("length" in kl or "perimeter" in kl):
                length = v
    return vol, area, length


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
    import bonsai.tool as tool
    import ifcopenshell.util.element as ue

    ifc = tool.Ifc.get()
    if ifc is None:
        return {"error": "No IFC model loaded in Bonsai. Open an .ifc in Blender first."}

    # Optional geometric fallback machinery.
    geom_settings = ushape = None
    try:
        import ifcopenshell.geom
        import ifcopenshell.util.shape as ushape  # noqa: F811
        geom_settings = ifcopenshell.geom.settings()
    except Exception:
        geom_settings = ushape = None

    groups = {}
    total = 0
    missing = 0
    zero = 0

    for el in ifc.by_type(IFC_CLASS):
        if not getattr(el, "GlobalId", None):
            continue
        total += 1

        psets = ue.get_psets(el, qtos_only=True)
        vol, area, length = _pull_quantities(psets)
        source = "pset" if (vol or area or length) else None

        if source is None and geom_settings is not None and getattr(el, "Representation", None):
            try:
                import ifcopenshell.geom
                shp = ifcopenshell.geom.create_shape(geom_settings, el)
                g = shp.geometry
                vol = ushape.get_volume(g)
                source = "geometry"
            except Exception:
                source = None

        if source is None:
            missing += 1
        elif not (vol or area or length):
            zero += 1

        key = str(_group_key(el, ue))
        b = groups.setdefault(key, {
            "count": 0, "volume": 0.0, "area": 0.0, "length": 0.0,
            "from_pset": 0, "from_geometry": 0, "no_quantity": 0,
        })
        b["count"] += 1
        b["volume"] += vol or 0.0
        b["area"] += area or 0.0
        b["length"] += length or 0.0
        b["from_pset" if source == "pset" else "from_geometry" if source == "geometry" else "no_quantity"] += 1

    # round for readability
    for b in groups.values():
        for m in ("volume", "area", "length"):
            b[m] = round(b[m], 4)

    return {
        "group_by": GROUP_BY,
        "ifc_class": IFC_CLASS,
        "schema": ifc.schema,
        "total_elements": total,
        "groups": groups,
        "warnings": {
            "missing_quantity_count": missing,
            "zero_quantity_count": zero,
        },
    }


try:
    result = main()
except Exception as e:  # never let an exception kill the socket handler silently
    result = {"error": str(e), "traceback": traceback.format_exc()}

print("QTO_JSON_START")
print(json.dumps(result, indent=2, default=str))
print("QTO_JSON_END")
