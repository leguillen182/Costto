import { describe, it, expect } from "vitest";
import { ordered, normalizeSiblings, indent, outdent, move, removeItem, addGroup, addLine } from "./tree.js";
import type { BoqItem } from "./types.js";

function g(id: string, parentId: string | null, sortOrder: number): BoqItem {
  return { id, boqId: "b", parentId, sortOrder, code: id, description: id, nodeType: "group" };
}
function l(id: string, parentId: string | null, sortOrder: number): BoqItem {
  return { id, boqId: "b", parentId, sortOrder, code: id, description: id, nodeType: "line", lineType: "unit_price", quantity: 1, unit: "u", unitRate: 10 };
}

// c1 { l1, l2 } · c2 { l3 }
function tree(): BoqItem[] {
  return [g("c1", null, 1), l("l1", "c1", 1), l("l2", "c1", 2), g("c2", null, 2), l("l3", "c2", 1)];
}

const ids = (items: BoqItem[]) => ordered(items).map((x) => x.item.id);

describe("ordered", () => {
  it("recorre el árbol en DFS con profundidad", () => {
    const rows = ordered(tree());
    expect(rows.map((r) => `${r.item.id}@${r.depth}`)).toEqual(["c1@0", "l1@1", "l2@1", "c2@0", "l3@1"]);
  });
  it("respeta sortOrder dentro de cada nivel", () => {
    const items = [l("a", null, 3), l("b", null, 1), l("c", null, 2)];
    expect(ids(items)).toEqual(["b", "c", "a"]);
  });
});

describe("normalizeSiblings", () => {
  it("renumera 1..n preservando el orden, sin tocar otros padres", () => {
    const items = [l("a", "c1", 0.5), l("b", "c1", 9999), l("z", "c2", 7)];
    const out = normalizeSiblings(items, "c1");
    expect(out.find((i) => i.id === "a")!.sortOrder).toBe(1);
    expect(out.find((i) => i.id === "b")!.sortOrder).toBe(2);
    expect(out.find((i) => i.id === "z")!.sortOrder).toBe(7); // intacto (otro padre)
  });
  it("no muta la entrada", () => {
    const items = [l("a", "c1", 5)];
    normalizeSiblings(items, "c1");
    expect(items[0]!.sortOrder).toBe(5);
  });
});

describe("indent", () => {
  it("convierte la línea anterior en grupo y reparenta", () => {
    const out = indent(tree(), "l2"); // l2 bajo l1 (que era línea)
    const l1 = out.find((i) => i.id === "l1")!;
    const l2 = out.find((i) => i.id === "l2")!;
    expect(l1.nodeType).toBe("group");
    expect(l1.lineType).toBeUndefined();
    expect(l1.quantity).toBeUndefined();
    expect(l2.parentId).toBe("l1");
    expect(l2.sortOrder).toBe(1);
  });
  it("si el hermano anterior ya es grupo, solo reparenta", () => {
    const items = [g("c1", null, 1), l("x", null, 2)]; // x hermano de c1 en raíz
    const out = indent(items, "x");
    expect(out.find((i) => i.id === "x")!.parentId).toBe("c1");
    expect(out.find((i) => i.id === "c1")!.nodeType).toBe("group");
  });
  it("no-op si es el primer hermano (sin anterior)", () => {
    const items = tree();
    expect(indent(items, "l1")).toBe(items); // misma referencia → sin cambios
  });
  it("no muta la entrada", () => {
    const items = tree();
    indent(items, "l2");
    expect(items.find((i) => i.id === "l1")!.nodeType).toBe("line");
  });
});

describe("outdent", () => {
  it("sube un nivel, quedando tras el antiguo padre", () => {
    const out = outdent(tree(), "l1");
    expect(out.find((i) => i.id === "l1")!.parentId).toBeNull();
    // ahora en raíz junto a c1/c2; orden preservado
    expect(ids(out)).toContain("l1");
  });
  it("no-op en un nodo raíz", () => {
    const items = tree();
    expect(outdent(items, "c1")).toBe(items);
  });
});

describe("move", () => {
  it("baja un ítem entre sus hermanos", () => {
    const out = move(tree(), "l1", 1);
    expect(ids(out)).toEqual(["c1", "l2", "l1", "c2", "l3"]);
  });
  it("sube un ítem entre sus hermanos", () => {
    const out = move(tree(), "l2", -1);
    expect(ids(out)).toEqual(["c1", "l2", "l1", "c2", "l3"]);
  });
  it("no-op en los extremos", () => {
    const items = tree();
    expect(move(items, "l1", -1)).toBe(items);
    expect(move(items, "l2", 1)).toBe(items);
  });
});

describe("removeItem", () => {
  it("elimina en cascada un grupo y sus descendientes", () => {
    const out = removeItem(tree(), "c1");
    expect(ids(out)).toEqual(["c2", "l3"]);
  });
  it("cascada multinivel", () => {
    // c1 > sub(group) > leaf
    const items = [g("c1", null, 1), g("sub", "c1", 1), l("leaf", "sub", 1), l("keep", null, 2)];
    const out = removeItem(items, "c1");
    expect(ids(out)).toEqual(["keep"]);
  });
  it("no muta la entrada", () => {
    const items = tree();
    removeItem(items, "c1");
    expect(items).toHaveLength(5);
  });
});

describe("addGroup / addLine", () => {
  it("addGroup añade un capítulo en raíz y normaliza hermanos", () => {
    const out = addGroup(tree(), "b", null, "c3");
    const c3 = out.find((i) => i.id === "c3")!;
    expect(c3.nodeType).toBe("group");
    expect(c3.sortOrder).toBe(3); // tras c1(1), c2(2)
    expect(ids(out)).toEqual(["c1", "l1", "l2", "c2", "l3", "c3"]);
  });
  it("addLine con afterSort cae justo después de esa posición", () => {
    const out = addLine(tree(), "b", "c1", "lNew", 1); // después de l1 (sort 1)
    const order = ordered(out).filter((r) => r.item.parentId === "c1").map((r) => r.item.id);
    expect(order).toEqual(["l1", "lNew", "l2"]);
  });
  it("addLine sin afterSort va al final del grupo", () => {
    const out = addLine(tree(), "b", "c1", "lNew");
    const order = ordered(out).filter((r) => r.item.parentId === "c1").map((r) => r.item.id);
    expect(order).toEqual(["l1", "l2", "lNew"]);
  });
  it("no muta la entrada", () => {
    const items = tree();
    addGroup(items, "b", null, "c3");
    expect(items).toHaveLength(5);
  });
});
