import type { IRange } from '../../core/types';

export type { IRange };

export interface TextEdit {
  range: IRange;
  text: string;
}

export interface IMarkdownString {
  value: string;
  isTrusted?: boolean;
}

export interface FormattingOptions {
  tabSize: number;
  insertSpaces: boolean;
}

export interface Location {
  uri?: { toString(): string };
  range: IRange;
}

export interface LocationLink {
  targetUri?: { toString(): string };
  targetRange: IRange;
  targetSelectionRange?: IRange;
  originSelectionRange?: IRange;
}

export interface IWorkspaceTextEdit {
  resource?: { toString(): string };
  textEdit: TextEdit;
}

export interface WorkspaceEdit {
  edits: IWorkspaceTextEdit[];
}

export interface CodeActionCommand {
  id: string;
  title: string;
  arguments?: unknown[];
}

export interface CancellationToken {
  isCancellationRequested: boolean;
}

export type ModelLike = {
  id?: string;
  uri?: { toString(): string };
  uriString?: string;
  getValue(): string;
  getValueInRange?(range: IRange): string;
  getLineContent(line: number): string;
  getLineCount?(): number;
  getOffsetAt?(line: number, column: number): number;
  getPositionAt?(offset: number): { lineNumber: number; column: number };
  getLanguageId?(): string;
  getVersionId?(): number;
  getWordAtPosition?(position: { lineNumber: number; column: number }): { word: string; startColumn: number; endColumn: number } | null;
  getWordUntilPosition?(position: { lineNumber: number; column: number }): { word: string; startColumn: number; endColumn: number };
};
