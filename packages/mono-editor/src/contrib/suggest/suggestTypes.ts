import type { WidgetBoxRect } from '../../browser/editor/editorTypes';
import type {
  AcceptSuggestionOnEnterMode,
  SnippetSuggestionsMode,
  SuggestInsertMode,
  SuggestPreviewMode,
  SuggestSelectionMode,
  TabCompletionMode,
  WordBasedSuggestionsMode,
} from '../../common/config/editorOptions';
import type { GhostTextItem, ModelLike } from '../../common/languages/providers/types';
import type { SuggestDocsMode } from './SuggestWidget';

export type QuickSuggestionsOption =
  | boolean
  | {
      other?: boolean | 'on' | 'off';
      comments?: boolean | 'on' | 'off';
      strings?: boolean | 'on' | 'off';
    };

export interface SuggestControllerOptions {
  quickSuggestions?: QuickSuggestionsOption;
  quickSuggestionsDelay?: number;
  suggestOnTriggerCharacters?: boolean;
  suggestMode?: 'palette' | 'ghost';
  suggestDocs?: SuggestDocsMode;
  acceptSuggestionOnCommitCharacter?: boolean;
  acceptSuggestionOnEnter?: AcceptSuggestionOnEnterMode;
  suggestSelection?: SuggestSelectionMode;
  insertMode?: SuggestInsertMode;
  filterGraceful?: boolean;
  matchOnWordStartOnly?: boolean;
  localityBonus?: boolean;
  preview?: boolean;
  previewMode?: SuggestPreviewMode;
  showIcons?: boolean;
  showStatusBar?: boolean;
  wordBasedSuggestions?: WordBasedSuggestionsMode;
  snippetSuggestions?: SnippetSuggestionsMode;
  tabCompletion?: TabCompletionMode;
  kindVisibility?: Partial<Record<number, boolean>>;
  getTokenTypeAt?: (lineNumber: number, column: number) => string | null;
  getLanguageIdAtPosition?: (lineNumber: number, column: number) => string;
  getModelLike?: (effectiveLang?: string) => ModelLike;
  onVisibilityChange?: (visible: boolean, rect: WidgetBoxRect | null) => void;
  setGhostTexts?: (items: readonly GhostTextItem[]) => void;
  clearGhostTexts?: (owner?: string) => void;
  getGhostTexts?: (owner?: string) => readonly GhostTextItem[];
  onTabFallback?: () => void;
}
