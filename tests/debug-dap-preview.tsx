import React from "react";
import { createRoot } from "react-dom/client";
import { debugVariables } from "../src/debug-model";
import { VariableNode } from "../src/debug-variable-tree";
import "../src/style.css";
const evidence = (window as unknown as { __dapEvidence: { locals: unknown[]; responses: Record<string, unknown[]> } }).__dapEvidence;
const read = async (reference: number, start = 0, count = 100) => {
  const variables = evidence.responses[String(reference)];
  if (!variables) throw new Error(`No captured variables response for reference ${reference}`);
  const page = variables.slice(start, start + count);
  return { items: debugVariables(page), received: page.length, limited: false };
};
createRoot(document.getElementById("root")!).render(<main className="debug-panel" style={{ width: "min(680px, calc(100vw - 40px))", boxSizing: "border-box", margin: "24px auto", padding: 20, background: "var(--paper)", border: "1px solid var(--line)", borderRadius: 8 }}>
  <div className="debug-variables" aria-label="实际调试数据">
    {debugVariables(evidence.locals).filter(variable => ["map", "string_map", "empty", "set", "vector"].includes(variable.name)).map(variable => <VariableNode key={variable.name} variable={variable} token="captured-native-pause" read={read} />)}
  </div>
</main>);
