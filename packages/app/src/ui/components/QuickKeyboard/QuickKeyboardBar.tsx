// src/ui/components/QuickKeyboard/QuickKeyboardBar.tsx
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { MonoCommands, type IMonoEditor } from '@mono/editor';
import * as monaco from '@/core/mono';
import {
  useQuickKeyboardStore,
  type ModifierKey,
  type ModifierState,
} from '@/store/quickKeyboardStore';
import { useTabStore } from '@/store/tabStore';
import { useSettingsStore } from '@/features/settings/store/settingsStore';
import { useActiveEditorStore } from '@/features/editor/store/activeEditorStore';
import { commands } from '@/core/extensionAPI/registry/commandRegistry';
import { Icon } from '@/ui/components/Icon/IconRegistry';
import './QuickKeyboardBar.css';

interface Mods {
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
}

function getActiveMonoEditor(): IMonoEditor | null {
  const fromStore = useActiveEditorStore.getState().activeEditor;
  if (fromStore) return fromStore;
  const winEd = (window as any).__monoEditor as IMonoEditor | undefined;
  if (winEd) return winEd;
  const editors = monaco.editor.getEditors?.() ?? [];
  return (editors.find((e: any) => e.hasTextFocus?.()) ?? editors[0] ?? null) as IMonoEditor | null;
}

function getMonoInputTarget(editor: IMonoEditor): HTMLElement | null {
  const root = editor.getDomNode?.();
  if (!root) return null;
  return (root.querySelector('textarea') as HTMLElement | null) ?? root;
}

function dispatchMonoKey(
  editor: IMonoEditor,
  key: string,
  code: string,
  keyCode: number,
  mods: Mods,
): boolean {
  const target = getMonoInputTarget(editor);
  if (!target) return false;
  const evt = new KeyboardEvent('keydown', {
    key,
    code,
    keyCode,
    which: keyCode,
    ctrlKey: mods.ctrl,
    altKey: mods.alt,
    shiftKey: mods.shift,
    metaKey: false,
    bubbles: true,
    cancelable: true,
  });
  target.dispatchEvent(evt);
  return evt.defaultPrevented;
}

function charToCode(char: string): { code: string; keyCode: number } {
  const upper = char.toUpperCase();
  if (upper >= 'A' && upper <= 'Z') {
    return { code: `Key${upper}`, keyCode: upper.charCodeAt(0) };
  }
  if (char >= '0' && char <= '9') {
    return { code: `Digit${char}`, keyCode: char.charCodeAt(0) };
  }
  const punctuation: Record<string, [string, number]> = {
    '/': ['Slash', 191],
    '.': ['Period', 190],
    ',': ['Comma', 188],
    ';': ['Semicolon', 186],
    '[': ['BracketLeft', 219],
    ']': ['BracketRight', 221],
    '\\': ['Backslash', 220],
    '-': ['Minus', 189],
    '=': ['Equal', 187],
    '`': ['Backquote', 192],
    "'": ['Quote', 222],
  };
  const hit = punctuation[char];
  if (hit) return { code: hit[0], keyCode: hit[1] };
  return { code: '', keyCode: upper.charCodeAt(0) || 0 };
}

function runModifierCharAction(char: string, mods: Mods, editor: IMonoEditor): void {
  const lower = char.toLowerCase();

  // Workbench shortcuts that bubble to window
  if (mods.ctrl && lower === 'p') {
    window.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'p',
        code: 'KeyP',
        keyCode: 80,
        ctrlKey: true,
        shiftKey: mods.shift,
        bubbles: true,
        cancelable: true,
      }),
    );
    return;
  }

  // Explicit save command
  if (mods.ctrl && !mods.alt && !mods.shift && lower === 's') {
    if (commands.hasCommand('workbench.action.files.save')) {
      void commands.executeCommand('workbench.action.files.save');
    } else {
      void editor.executeCommand?.('editor.action.save');
    }
    return;
  }

  // Touch-safe paste
  if (mods.ctrl && !mods.alt && !mods.shift && lower === 'v') {
    if (navigator.clipboard?.readText) {
      navigator.clipboard
        .readText()
        .then((text) => {
          if (text) editor.trigger?.('keyboard', 'type', { text });
        })
        .catch(() => {
          void editor.executeCommand?.('editor.action.clipboardPasteAction');
        });
    } else {
      void editor.executeCommand?.('editor.action.clipboardPasteAction');
    }
    return;
  }

  // Shift-only printable character typing
  if (mods.shift && !mods.ctrl && !mods.alt) {
    const shiftMap: Record<string, string> = {
      '1': '!', '2': '@', '3': '#', '4': '$', '5': '%',
      '6': '^', '7': '&', '8': '*', '9': '(', '0': ')',
      '-': '_', '=': '+', '[': '{', ']': '}', '\\': '|',
      ';': ':', "'": '"', ',': '<', '.': '>', '/': '?',
    };
    editor.trigger?.('keyboard', 'type', { text: shiftMap[lower] ?? lower.toUpperCase() });
    return;
  }

  // Route through Mono's native KeybindingService / KeyboardController
  const { code, keyCode } = charToCode(char);
  const handled = dispatchMonoKey(editor, lower, code, keyCode, mods);
  if (handled) return;

  // Fallbacks for direct Mono commands
  if (mods.ctrl && !mods.alt) {
    if (lower === 'a') void editor.executeCommand?.(MonoCommands.SelectAll);
    else if (lower === 'z') void editor.executeCommand?.(mods.shift ? MonoCommands.Redo : MonoCommands.Undo);
    else if (lower === 'y') void editor.executeCommand?.(MonoCommands.Redo);
    else if (lower === '/') void editor.executeCommand?.(MonoCommands.CommentLine);
    else if (lower === 'f') editor.revealFind?.();
    else if (lower === 'h') editor.revealReplace?.();
    else if (lower === 'g') void editor.executeCommand?.(MonoCommands.GoToLine);
    else if (lower === 'd') void editor.executeCommand?.(MonoCommands.AddSelectionToNextFindMatch);
  } else if (mods.alt && !mods.ctrl && lower === 'z') {
    void editor.executeCommand?.('editor.action.toggleWordWrap');
  }
}

function useKeyboardOffset(isVisible: boolean) {
  const [offset, setOffset] = useState(0);
  useEffect(() => {
    if (!isVisible) {
      setOffset(0);
      return;
    }
    if ('virtualKeyboard' in navigator) {
      const vk = (navigator as any).virtualKeyboard;
      vk.overlaysContent = true;
      const onChange = (e: any) => setOffset(e.target.boundingRect.height);
      vk.addEventListener('geometrychange', onChange);
      return () => vk.removeEventListener('geometrychange', onChange);
    }
  }, [isVisible]);
  return offset;
}

const SPECIAL_KEY_MAP: Record<string, [string, string, number]> = {
  cursorUp: ['ArrowUp', 'ArrowUp', 38],
  cursorDown: ['ArrowDown', 'ArrowDown', 40],
  cursorLeft: ['ArrowLeft', 'ArrowLeft', 37],
  cursorRight: ['ArrowRight', 'ArrowRight', 39],
  tab: ['Tab', 'Tab', 9],
  enter: ['Enter', 'Enter', 13],
  esc: ['Escape', 'Escape', 27],
  backspace: ['Backspace', 'Backspace', 8],
  delete: ['Delete', 'Delete', 46],
};

export const QuickKeyboardBar: React.FC = () => {
  const {
    isVisible,
    keys,
    setKeys,
    modifierStates,
    toggleModifier,
    consumeArmedModifiers,
  } = useQuickKeyboardStore();
  const { activeTabId, tabs } = useTabStore();
  const settings = useSettingsStore((s) => s.settings);
  const keyboardOffset = useKeyboardOffset(isVisible);
  const hiddenInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const configKeys = settings['workbench.editor.quickKeyboard.keys'];
    if (Array.isArray(configKeys)) setKeys(configKeys);
  }, [settings, setKeys]);

  // Intercept soft-keyboard printable character input while a sticky modifier is armed/locked
  useEffect(() => {
    const onBeforeInput = (e: InputEvent) => {
      const { ctrl, alt, shift } = useQuickKeyboardStore.getState().modifiers;
      if (!ctrl && !alt && !shift) return;
      const char = e.data;
      if (!char || char.length !== 1) return;
      const editor = getActiveMonoEditor();
      if (!editor) return;
      const dom = editor.getDomNode?.();
      if (!dom || !dom.contains(e.target as Node)) return;

      e.preventDefault();
      e.stopPropagation();
      runModifierCharAction(char, { ctrl, alt, shift }, editor);
      consumeArmedModifiers();
    };

    window.addEventListener('beforeinput', onBeforeInput as EventListener, true);
    return () => window.removeEventListener('beforeinput', onBeforeInput as EventListener, true);
  }, [consumeArmedModifiers]);

  const handleKeyClick = useCallback(
    (action: string) => {
      if (action === 'ctrl' || action === 'alt' || action === 'shift') {
        toggleModifier(action as ModifierKey);
        return;
      }

      const { ctrl, alt, shift } = useQuickKeyboardStore.getState().modifiers;
      const mods: Mods = { ctrl, alt, shift };
      const hasModifier = ctrl || alt || shift;

      const rawTab = tabs.find((t) => t.id === activeTabId);
      if (rawTab?.type === 'termis') {
        const tc = (rawTab as any).terminalComponent;
        if (action.startsWith('type_') && tc?.terminal) {
          tc.terminal.paste?.(action.slice(5));
        } else if (tc?.terminal?.textarea && SPECIAL_KEY_MAP[action]) {
          const [key, code, keyCode] = SPECIAL_KEY_MAP[action]!;
          tc.terminal.textarea.dispatchEvent(
            new KeyboardEvent('keydown', {
              key,
              code,
              keyCode,
              which: keyCode,
              ctrlKey: ctrl,
              altKey: alt,
              shiftKey: shift,
              bubbles: true,
              cancelable: true,
            }),
          );
        }
        if (hasModifier) consumeArmedModifiers();
        return;
      }

      const editor = getActiveMonoEditor();
      if (!editor) return;

      // Special keys: route through real Mono keydown / MonoCommands
      if (SPECIAL_KEY_MAP[action]) {
        const [key, code, keyCode] = SPECIAL_KEY_MAP[action]!;
        if (action === 'cursorUp' && mods.alt && !mods.ctrl) {
          void editor.executeCommand?.(
            mods.shift ? MonoCommands.CopyLinesUp : MonoCommands.MoveLinesUp,
          );
        } else if (action === 'cursorDown' && mods.alt && !mods.ctrl) {
          void editor.executeCommand?.(
            mods.shift ? MonoCommands.CopyLinesDown : MonoCommands.MoveLinesDown,
          );
        } else {
          dispatchMonoKey(editor, key, code, keyCode, mods);
        }
        editor.focus?.();
        if (hasModifier) consumeArmedModifiers();
        return;
      }

      if (action.startsWith('type_')) {
        const char = action.slice(5);
        if (hasModifier) runModifierCharAction(char, mods, editor);
        else editor.trigger?.('keyboard', 'type', { text: char });
        editor.focus?.();
        if (hasModifier) consumeArmedModifiers();
        return;
      }

      if (action === 'actions.find' || action === 'editor.action.startFindAction') {
        editor.revealFind?.();
        if (hasModifier) consumeArmedModifiers();
        return;
      }

      if (commands.hasCommand(action)) {
        void commands.executeCommand(action);
        if (hasModifier) consumeArmedModifiers();
        return;
      }

      if (typeof editor.executeCommand === 'function') {
        void editor.executeCommand(action);
      } else {
        editor.trigger?.('keyboard', action, null);
      }
      editor.focus?.();
      if (hasModifier) consumeArmedModifiers();
    },
    [toggleModifier, consumeArmedModifiers, tabs, activeTabId],
  );

  const activeTab = tabs.find((t) => t.id === activeTabId);
  if (!(isVisible && !!activeTab && activeTab.showQuickBar !== false)) return null;

  const floatingStyle: React.CSSProperties =
    keyboardOffset > 0
      ? {
          position: 'absolute',
          bottom: `${Math.max(0, keyboardOffset - 24)}px`,
          left: 0,
          right: 0,
          zIndex: 99999,
          boxShadow: '0 -4px 10px rgba(0,0,0,0.4)',
          borderTop: '1px solid var(--ms-accent)',
        }
      : {};

  return (
    <div
      className="ms-quick-keyboard"
      style={floatingStyle}
      onPointerDown={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
    >
      <input
        ref={hiddenInputRef}
        type="text"
        aria-hidden="true"
        tabIndex={-1}
        style={{ display: 'none' }}
      />

      {keys.map((k: any) => {
        const isModKey = k.action === 'ctrl' || k.action === 'alt' || k.action === 'shift';
        const modState: ModifierState = isModKey
          ? modifierStates[k.action as ModifierKey]
          : 'off';
        const modClass =
          modState === 'locked'
            ? ' mod-locked'
            : modState === 'armed'
              ? ' mod-armed'
              : '';
        const title = isModKey
          ? modState === 'locked'
            ? `${k.label} locked (tap to unlock)`
            : modState === 'armed'
              ? `${k.label} armed for next key (double-tap to lock)`
              : `${k.label} (tap for one-shot, double-tap to lock)`
          : k.label || k.action;

        return (
          <button
            key={k.id}
            type="button"
            className={`ms-qk-btn${modClass}`}
            aria-pressed={isModKey ? modState !== 'off' : undefined}
            data-mod-state={isModKey ? modState : undefined}
            title={title}
            onClick={() => handleKeyClick(k.action)}
          >
            {k.icon ? <Icon name={k.icon as any} size={14} /> : k.label}
            {modState === 'armed' && <span className="ms-qk-mod-dot" aria-hidden="true" />}
            {modState === 'locked' && <span className="ms-qk-mod-lock" aria-hidden="true" />}
          </button>
        );
      })}
    </div>
  );
};