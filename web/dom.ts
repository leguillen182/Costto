// Utilidades DOM compartidas por el editor (main.ts) y la vista QTO (qto.ts).

/** Crea un <button> con texto, handler de click y clase opcional. */
export function button(label: string, onClick: () => void, cls = ""): HTMLButtonElement {
  const b = document.createElement("button");
  b.textContent = label;
  if (cls) b.className = cls;
  b.addEventListener("click", onClick);
  return b;
}
