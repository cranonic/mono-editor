import type {
  BreadcrumbFolderClickBehavior,
  BreadcrumbPathMode,
  BreadcrumbSymbolSortOrder,
  MonoBreadcrumbsKindFilter,
  MonoBreadcrumbsOptions,
} from '../config/editorOptions';
import type { IRange, MonoDisposable } from '../core/types';
import { SymbolKind, type DocumentSymbol } from '../languages/providers/types';

export type BreadcrumbItemKind = 'file' | 'folder' | 'symbol';

export interface IBreadcrumbItem {
  readonly id: string;
  readonly kind: BreadcrumbItemKind;
  readonly label: string;
  readonly detail?: string;
  readonly uri?: string;
  readonly path?: string;
  readonly isDirectory?: boolean;
  readonly symbolKind?: SymbolKind;
  readonly range?: IRange;
  readonly selectionRange?: IRange;
  readonly symbol?: DocumentSymbol;
  readonly children?: readonly DocumentSymbol[];
}

export interface IBreadcrumbsPathProvider {
  getPath(uri: string): readonly IBreadcrumbItem[] | Promise<readonly IBreadcrumbItem[]>;
  getSiblings(item: IBreadcrumbItem): readonly IBreadcrumbItem[] | Promise<readonly IBreadcrumbItem[]>;
  openItem?(item: IBreadcrumbItem): void | Promise<void>;
}

export interface ResolvedBreadcrumbsOptions extends Required<MonoBreadcrumbsKindFilter> {
  enabled: boolean;
  filePath: BreadcrumbPathMode;
  symbolPath: BreadcrumbPathMode;
  icons: boolean;
  symbolSortOrder: BreadcrumbSymbolSortOrder;
  symbolPathSeparator: string;
  showSymbolDetails: boolean;
  folderClickBehavior: BreadcrumbFolderClickBehavior;
}

export const DEFAULT_BREADCRUMBS_OPTIONS: ResolvedBreadcrumbsOptions = {
  enabled: true,
  filePath: 'on',
  symbolPath: 'on',
  icons: true,
  symbolSortOrder: 'position',
  symbolPathSeparator: ' › ',
  showSymbolDetails: false,
  folderClickBehavior: 'expand',
  showFiles: true,
  showModules: true,
  showNamespaces: true,
  showPackages: true,
  showClasses: true,
  showMethods: true,
  showProperties: true,
  showFields: true,
  showConstructors: true,
  showEnums: true,
  showInterfaces: true,
  showFunctions: true,
  showVariables: true,
  showConstants: true,
  showStrings: true,
  showNumbers: true,
  showBooleans: true,
  showArrays: true,
  showObjects: true,
  showKeys: true,
  showNull: true,
  showEnumMembers: true,
  showStructs: true,
  showEvents: true,
  showOperators: true,
  showTypeParameters: true,
};

export function resolveBreadcrumbsOptions(
  opts?: Partial<MonoBreadcrumbsOptions>,
): ResolvedBreadcrumbsOptions {
  return { ...DEFAULT_BREADCRUMBS_OPTIONS, ...(opts ?? {}) };
}

const SYMBOL_KIND_TO_OPTION_KEY: Record<number, keyof MonoBreadcrumbsKindFilter> = {
  [SymbolKind.File]: 'showFiles',
  [SymbolKind.Module]: 'showModules',
  [SymbolKind.Namespace]: 'showNamespaces',
  [SymbolKind.Package]: 'showPackages',
  [SymbolKind.Class]: 'showClasses',
  [SymbolKind.Method]: 'showMethods',
  [SymbolKind.Property]: 'showProperties',
  [SymbolKind.Field]: 'showFields',
  [SymbolKind.Constructor]: 'showConstructors',
  [SymbolKind.Enum]: 'showEnums',
  [SymbolKind.Interface]: 'showInterfaces',
  [SymbolKind.Function]: 'showFunctions',
  [SymbolKind.Variable]: 'showVariables',
  [SymbolKind.Constant]: 'showConstants',
  [SymbolKind.String]: 'showStrings',
  [SymbolKind.Number]: 'showNumbers',
  [SymbolKind.Boolean]: 'showBooleans',
  [SymbolKind.Array]: 'showArrays',
  [SymbolKind.Object]: 'showObjects',
  [SymbolKind.Key]: 'showKeys',
  [SymbolKind.Null]: 'showNull',
  [SymbolKind.EnumMember]: 'showEnumMembers',
  [SymbolKind.Struct]: 'showStructs',
  [SymbolKind.Event]: 'showEvents',
  [SymbolKind.Operator]: 'showOperators',
  [SymbolKind.TypeParameter]: 'showTypeParameters',
};

export function isSymbolKindVisibleInBreadcrumbs(
  kind: SymbolKind,
  opts: ResolvedBreadcrumbsOptions,
): boolean {
  const key = SYMBOL_KIND_TO_OPTION_KEY[kind];
  return key ? opts[key] !== false : true;
}

export function sortBreadcrumbSymbols(
  symbols: readonly DocumentSymbol[],
  order: BreadcrumbSymbolSortOrder,
): DocumentSymbol[] {
  const copy = [...symbols];
  if (order === 'name') {
    copy.sort((a, b) => a.name.localeCompare(b.name));
  } else if (order === 'type') {
    copy.sort((a, b) => a.kind - b.kind || a.name.localeCompare(b.name));
  } else {
    copy.sort(
      (a, b) =>
        a.range.startLineNumber - b.range.startLineNumber ||
        a.range.startColumn - b.range.startColumn,
    );
  }
  return copy;
}

export interface IBreadcrumbsSnapshot {
  readonly enabled: boolean;
  readonly options: ResolvedBreadcrumbsOptions;
  readonly items: readonly IBreadcrumbItem[];
  readonly fileItems: readonly IBreadcrumbItem[];
  readonly symbolItems: readonly IBreadcrumbItem[];
  readonly focusedIndex: number;
  readonly pickerOpen: boolean;
}

export interface IBreadcrumbsModel {
  getOptions(): ResolvedBreadcrumbsOptions;
  updateOptions(patch: Partial<MonoBreadcrumbsOptions>): void;
  setPathProvider(provider: IBreadcrumbsPathProvider | null): void;
  getSnapshot(): IBreadcrumbsSnapshot;
  getItems(): readonly IBreadcrumbItem[];
  getFocusedIndex(): number;
  isPickerOpen(): boolean;
  setFocusedIndex(index: number, openPicker?: boolean): void;
  setPickerOpen(open: boolean): void;
  focus(): void;
  focusAndSelect(): void;
  focusNext(openPicker?: boolean): void;
  focusPrevious(openPicker?: boolean): void;
  selectFocused(): void;
  revealFocused(): void;
  selectEditor(): void;
  toggle(): void;
  getSiblings(item: IBreadcrumbItem): Promise<readonly IBreadcrumbItem[]>;
  getOutlineForPicker(): readonly DocumentSymbol[];
  getCopyPath(): string;
  refresh(): void;
  onDidChange(listener: (snapshot: IBreadcrumbsSnapshot) => void): MonoDisposable;
}
