// Adapter registry — business code imports the interface, never a concrete
// adapter (architecture rule 3). Adding a provider touches this file only.
import { agentboxdAdapter } from "./agentboxd.js";
import { copyOnlyAdapter } from "./copy-only.js";
import { openMailAdapter } from "./openmail.js";
import type { EmailAdapter } from "./types.js";

const ADAPTERS: EmailAdapter[] = [copyOnlyAdapter, agentboxdAdapter, openMailAdapter];

export function getEmailAdapter(id: string): EmailAdapter | undefined {
  return ADAPTERS.find((a) => a.id === id);
}

/** Metadata for the Settings form — never includes adapter functions. */
export interface AdapterDescription {
  id: string;
  label: string;
  capabilities: EmailAdapter["capabilities"];
  configFields: EmailAdapter["configFields"];
}

export function listEmailAdapters(): AdapterDescription[] {
  return ADAPTERS.map(({ id, label, capabilities, configFields }) => ({
    id,
    label,
    capabilities,
    configFields,
  }));
}

/** Test-only: register or replace an adapter (e.g., a timeout stub). Not for production code. */
export function _registerAdapterForTests(adapter: EmailAdapter): void {
  const existing = ADAPTERS.findIndex((a) => a.id === adapter.id);
  if (existing >= 0) ADAPTERS[existing] = adapter;
  else ADAPTERS.push(adapter);
}
