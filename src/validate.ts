// Motor de validación del BOQ (Tarea A1). Función PURA: sin DB, sin UI.
// Reglas duras del estimador: cantidades/precios faltantes, duplicados, capítulos vacíos, desglose.
import type { Boq, BoqItem } from "./types.js";

export type Severity = "error" | "warning";

export interface ValidationIssue {
  itemId: string | null;
  rule: string;
  severity: Severity;
  message: string;
}

export function validate(boq: Boq, items: BoqItem[]): ValidationIssue[] {
  const own = items.filter((i) => i.boqId === boq.id);
  const issues: ValidationIssue[] = [];

  const childrenByParent = new Map<string | null, BoqItem[]>();
  for (const it of own) {
    const arr = childrenByParent.get(it.parentId);
    if (arr) arr.push(it);
    else childrenByParent.set(it.parentId, [it]);
  }

  // Conteo de códigos (no vacíos) para detectar duplicados.
  const codeCount = new Map<string, number>();
  for (const it of own) {
    const c = it.code?.trim();
    if (c) codeCount.set(c, (codeCount.get(c) ?? 0) + 1);
  }

  for (const it of own) {
    if (!it.description || !it.description.trim()) {
      issues.push({ itemId: it.id, rule: "empty_description", severity: "warning", message: "Descripción vacía" });
    }
    const c = it.code?.trim();
    if (c && (codeCount.get(c) ?? 0) > 1) {
      issues.push({ itemId: it.id, rule: "duplicate_code", severity: "warning", message: `Código duplicado: ${c}` });
    }

    if (it.nodeType === "group") {
      const kids = childrenByParent.get(it.id) ?? [];
      if (kids.length === 0) {
        issues.push({ itemId: it.id, rule: "empty_group", severity: "warning", message: "Capítulo sin partidas" });
      }
    } else {
      // Línea. unit_price y lump_sum requieren cantidad y precio.
      // provisional_sum y allowance pueden estar incompletos a propósito (no es error).
      const requiresValues = it.lineType == null || it.lineType === "unit_price" || it.lineType === "lump_sum";
      if (requiresValues) {
        if (it.quantity == null || it.quantity === 0) {
          issues.push({ itemId: it.id, rule: "missing_quantity", severity: "error", message: "Cantidad faltante o cero" });
        }
        if (it.unitRate == null || it.unitRate === 0) {
          issues.push({ itemId: it.id, rule: "missing_rate", severity: "error", message: "Precio unitario faltante o cero" });
        }
      }
      // Desglose de tarifa: si hay algún componente, debe sumar al unitRate.
      const parts = [it.rateLabor, it.rateMaterial, it.rateEquipment, it.rateSubcontract, it.rateOther];
      if (parts.some((p) => p != null)) {
        const sum = parts.reduce<number>((a, p) => a + (p ?? 0), 0);
        if (it.unitRate != null && Math.abs(sum - it.unitRate) > 0.005) {
          issues.push({ itemId: it.id, rule: "breakdown_mismatch", severity: "warning", message: `Desglose (${sum}) ≠ P. Unitario (${it.unitRate})` });
        }
      }
    }
  }

  return issues;
}

export function countBySeverity(issues: ValidationIssue[]): { errors: number; warnings: number } {
  return {
    errors: issues.filter((i) => i.severity === "error").length,
    warnings: issues.filter((i) => i.severity === "warning").length,
  };
}
