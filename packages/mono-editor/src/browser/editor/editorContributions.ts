import type { IEditorContribution, IEditorContributionHost } from './editorTypes';

export type EditorContributionFactory = (host: IEditorContributionHost) => IEditorContribution;

interface RegisteredContribution {
  id: string;
  factory: EditorContributionFactory;
}

const registry: RegisteredContribution[] = [];
const registryIds = new Set<string>();

/**
 * Registers an optional editor contribution (Monaco `registerEditorContribution` pattern).
 * Idempotent by `id` so repeated bootstrap calls never register duplicates.
 */
export function registerEditorContribution(id: string, factory: EditorContributionFactory): void {
  if (registryIds.has(id)) return;
  registryIds.add(id);
  registry.push({ id, factory });
}

/** Returns all registered contribution descriptors in registration order. */
export function getEditorContributions(): readonly RegisteredContribution[] {
  return registry;
}
