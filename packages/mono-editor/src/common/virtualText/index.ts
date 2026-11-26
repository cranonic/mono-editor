export { GhostTextModel, type GhostAcceptResult } from './GhostTextModel';
export {
  buildWrappedGhostRows,
  collectInlineVirtualElements,
  INLAY_CHIP_PAD_X,
  INLAY_OUTER_MARGIN,
  mapVirtualXToRealX,
  virtualAdvanceBeforeColumn,
  virtualElementStartX,
  virtualSideAtX,
  type InlineVirtualElement,
  type LineVirtualInputs,
} from './InlineVirtualLayout';
export {
  extractNextGhostLine,
  extractNextGhostWord,
  splitGhostText,
  type GhostTextItem,
  type GhostTextKind,
  type InlayHint,
  type InlayHintKind,
  type InlayHintLabelPart,
  type InlineGhostRun,
  type NormalizedGhostText,
  type ResolvedInlayHint,
  type VirtualGhostRow,
} from './ghostTextTypes';
