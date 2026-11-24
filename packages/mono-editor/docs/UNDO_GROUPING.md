# Undo grouping

One Ctrl+Z undoes one *step*. A step is built like this:

| Input | Step |
|---|---|
| Typing (key, or an IME / Gboard word commit without newline) | consecutive typing merges while **adjacent**, **same caret**, **< 1.5 s apart** and **no word boundary** |
| Word boundary | a space/tab typed after a non-space starts a new step; further spaces and the next word stay with it → `hello world foo` undoes as `foo`, ` world`, `hello` |
| Backspace / Delete | a run of single-char deletes = one step (undo restores all of them, caret back at the start) |
| Typing over a selection | first edit of a burst: one Ctrl+Z restores the text **and** the selection; following keystrokes join it |
| Enter, Tab, paste, cut, completion accept, Find→Replace one, ctrl+Backspace, selection delete | always their own step |
| Replace All, `executeEdits([...])`, `model.transact(fn)` | the whole batch = one step |
| Caret move (tap, teardrop, arrows, Home/End, `setPosition`), undo/redo, `pushUndoStop()`, `setValue(…, false)` | closes the current step |

## API
```ts
editor.pushUndoStop();                         // Monaco: close the current step
editor.updateOptions({ undoGroupIdleMs: 3000 }); // pause that ends a burst (ms). 0 = never split on time. Default 1500
model.transact(() => { model.replaceRange(...); model.replaceRange(...); }); // one step
model.insert(offset, text, 'typing');          // kind: 'typing' | 'deleteLeft' | 'deleteRight' | 'other' (default)
model.pushStackElement();
```
Only `typing` / `deleteLeft` / `deleteRight` can merge; every other edit is `other`.

## Tests
```
cd packages/mono-editor
npx tsx tests/undo-group.test.mts      # 27 tests incl. 400-session fuzz (undo lands on the exact recorded state)
```
