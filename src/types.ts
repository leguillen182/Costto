// Modelo de dato del BOQ (Fase 1, estimador). Espejo de docs DATA_MODEL.md.
// Genérico y adaptable: árbol recursivo, group/line, clasificación pluggable, markups configurables.

export type NodeType = "group" | "line";

export type LineType =
  | "unit_price"
  | "lump_sum"
  | "provisional_sum"
  | "allowance";

export type MarkupType = "percentage" | "fixed";

/** Base sobre la que aplica un markup:
 *  - "subtotal": siempre sobre el subtotal original del BOQ.
 *  - "running": sobre el subtotal + markups previos (cascada). */
export type MarkupBasis = "subtotal" | "running";

/** Nivel de detalle del editor (progressive disclosure):
 *  - "simple": lista de precios (P.U. directo, sin desglose).
 *  - "detailed": permite desglosar el P.U. en componentes por partida. */
export type DetailLevel = "simple" | "detailed";

export interface Project {
  id: string; // UUID interno (estable, inmutable)
  name: string;
  code?: string;
  baseCurrency: string; // ISO 4217 (DOP, USD…)
  metadata?: Record<string, unknown>;
}

export interface Boq {
  id: string;
  projectId: string;
  name: string;
  kind: string; // owner_budget / contractor_bid / revision… (tag libre)
  version?: string | number;
  status?: string;
  currency: string;
  roundingDecimals: number; // ADR-011: default 2
  detailLevel?: DetailLevel; // default "simple"
  classificationSystem?: string;
  metadata?: Record<string, unknown>;
}

export interface BoqItem {
  id: string; // UUID interno estable
  boqId: string;
  parentId: string | null; // null = nodo raíz
  sortOrder: number;
  code?: string; // código de clasificación libre ("03 30 00", "EST-001"…)
  description: string;
  nodeType: NodeType;
  lineType?: LineType; // solo en line
  quantity?: number | null; // solo en line
  unit?: string; // solo en line
  unitRate?: number | null; // solo en line
  // Desglose opcional del unit_rate (cómo el estimador arma la tarifa).
  // Si se ingresan, deben sumar a unitRate (regla de validación P1).
  rateLabor?: number | null;
  rateMaterial?: number | null;
  rateEquipment?: number | null;
  rateSubcontract?: number | null;
  rateOther?: number | null;
  currency?: string; // override opcional; default = boq.currency
  customFields?: Record<string, unknown>;
}

export interface MarkupRule {
  id: string;
  boqId: string;
  name: string; // Overhead, Utilidad, ITBIS, Contingencia…
  type: MarkupType;
  value: number; // % si percentage; monto si fixed
  basis: MarkupBasis;
  sortOrder: number; // el orden importa (cascada)
}

// ---- Resultados del cálculo (contrato de dato entre cálculo y UI) ----

export interface MarkupResult {
  id: string;
  name: string;
  base: number; // base sobre la que se aplicó
  amount: number;
}

export interface BoqCalcResult {
  amounts: Record<string, number>; // itemId -> amount (redondeado)
  subtotal: number;
  markups: MarkupResult[];
  total: number;
}
