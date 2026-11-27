// src/core/keybindings/monoKeybindingBridge.ts

import { KeyCode, KeyMod, type IMonoEditor } from '@mono/editor';
import { commands } from '../extensionAPI/registry/commandRegistry';
import { contextKeyService } from './contextKeyService';
import { keybindingManager } from './keybindingManager';

/**
 * MonoKeybindingBridge Subsystem Engine
 * Adapts Mono Editor instance lifecycles to the central keybinding,
 * command registry, and context key evaluation systems.
 */
class MonoKeybindingBridge {
  private boundEditors = new WeakSet<IMonoEditor>();

  private hasSelectionCtx = contextKeyService.createKey('editorHasSelection', false);
  private hasTextFocusCtx = contextKeyService.createKey('editorTextFocus', false);

  public attach(editor: IMonoEditor): void {
    if (this.boundEditors.has(editor)) return;
    this.boundEditors.add(editor);

    this.syncCommands(editor);
    this.syncContextKeys(editor);
  }

  private syncCommands(editor: IMonoEditor): void {
    const actions = (editor as any).getSupportedActions?.() ?? [];

    const ignoredActionsForBindings = [
      'actions.find',
      'editor.actions.findWithSelection',
      'editor.action.nextMatchFindAction',
      'editor.action.previousMatchFindAction',
      'editor.action.startFindReplaceAction',
    ];

    actions.forEach((action: any) => {
      commands.registerCommand(action.id, () => {
        if (!editor.hasTextFocus?.()) editor.focus();
        action.run?.();
      });

      if (ignoredActionsForBindings.includes(action.id)) {
        return;
      }

      const keybindings: number[] = action._keybindings || [];
      keybindings.forEach((kbCode: number) => {
        const chordStr = this.convertKeyCodeToString(kbCode);
        if (chordStr && chordStr !== 'enter' && chordStr !== 'space' && chordStr !== 'tab') {
          keybindingManager.addDynamicBinding({
            key: chordStr,
            command: action.id,
            when: 'editorTextFocus',
          });
        }
      });
    });

    commands.registerCommand('editor.action.undo', () => editor.trigger('keyboard', 'undo', null));
    commands.registerCommand('editor.action.redo', () => editor.trigger('keyboard', 'redo', null));
  }

  private syncContextKeys(editor: IMonoEditor): void {
    editor.onDidChangeCursorSelection?.((e: any) => {
      const sel = e?.selection;
      const isEmpty =
        typeof sel?.isEmpty === 'function'
          ? sel.isEmpty()
          : sel
            ? sel.startLineNumber === sel.endLineNumber && sel.startColumn === sel.endColumn
            : true;
      this.hasSelectionCtx.set(!isEmpty);
    });

    editor.onDidFocusEditorText?.(() => {
      this.hasTextFocusCtx.set(true);
    });

    editor.onDidBlurEditorText?.(() => {
      this.hasTextFocusCtx.set(false);
    });
  }

  private convertKeyCodeToString(keyCode: number): string | null {
    const ctrlCmd = (keyCode & KeyMod.CtrlCmd) !== 0;
    const shift = (keyCode & KeyMod.Shift) !== 0;
    const alt = (keyCode & KeyMod.Alt) !== 0;
    const winCtrl = (keyCode & KeyMod.WinCtrl) !== 0;

    const key = keyCode & 0x000000ff;

    let keyStr = '';
    if (key >= KeyCode.KeyA && key <= KeyCode.KeyZ) {
      keyStr = String.fromCharCode(key - KeyCode.KeyA + 97);
    } else if (key >= KeyCode.Digit0 && key <= KeyCode.Digit9) {
      keyStr = String.fromCharCode(key - KeyCode.Digit0 + 48);
    } else if (key === KeyCode.F1) {
      keyStr = 'f1';
    } else if (key === KeyCode.Slash) {
      keyStr = '/';
    }

    if (!keyStr) return null;

    const parts: string[] = [];
    if (ctrlCmd) parts.push('ctrl');
    if (winCtrl) parts.push('meta');
    if (alt) parts.push('alt');
    if (shift) parts.push('shift');
    parts.push(keyStr);

    return parts.join('+');
  }
}

export const monoKeybindingBridge = new MonoKeybindingBridge();
