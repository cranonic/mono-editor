import type { TextModel } from './TextModel';
import type { IMonoTextModel } from '../core/types';

const backingModels = new WeakMap<IMonoTextModel, TextModel>();
const uriToStandalone = new Map<string, IMonoTextModel>();

export function registerBackingTextModel(
  wrapper: IMonoTextModel,
  backing: TextModel,
  uriKey?: string,
): void {
  backingModels.set(wrapper, backing);
  if (uriKey) uriToStandalone.set(uriKey, wrapper);
}

export function unregisterStandaloneModel(uriKey: string): void {
  uriToStandalone.delete(uriKey);
}

export function getBackingTextModel(wrapper: IMonoTextModel | null | undefined): TextModel | null {
  if (!wrapper) return null;
  return backingModels.get(wrapper) ?? null;
}

export function getRegisteredStandaloneModel(uriKey: string): IMonoTextModel | null {
  return uriToStandalone.get(uriKey) ?? null;
}

export function getAllRegisteredStandaloneModels(): IMonoTextModel[] {
  return Array.from(uriToStandalone.values());
}
