# Find widget · stable viewport · sticky scroll — test checklist (Android WebView)

Automated: `npx tsx tests/find-sticky.test.mts` (view logic, DPR sweep 1–3). Manual checks below.

## 1. Find seeds from the selection
1. Select a word (or any single-line text) → open Find (Ctrl+F / Find button) → the input already contains it,
   focused with the text selected, and the counter shows `N of M` with the **selected occurrence** as current.
2. Start typing → the seeded text is replaced; matches keep following without skipping to the next occurrence.
3. Close and reopen Find with nothing selected → the previous search term is still in the input.
4. Multi-line selection → input is not seeded (previous term stays).

## 2. Slide down / up
1. Open Find → the widget slides down from the top edge (≈170 ms) with a fade.
2. Close (Esc / ✕) → it slides up (≈130 ms) and cannot be tapped while leaving.
3. Open/close rapidly → no stuck or duplicated widgets.
4. With the OS “reduce motion” setting on → it appears/disappears instantly.

## 3. No jump when Find opens or closes
1. Scroll to the middle of a file, note the line under your finger → open Find → **nothing moves** (before this
   change everything dropped by the widget height). Close → nothing moves either.
2. Sticky headers (if any) are identical before / during / after Find.
3. Toggle the Replace row (chevron) → the code still doesn't move.
4. At the very top of the file: open Find → line 1 stays where it was (it is hidden behind the widget); scroll up
   a little → the empty gap above line 1 appears. Close while in the gap → content settles at the top.

## 4. Find next / previous always lands in a visible spot
1. Search a word that appears many times; press Enter / Shift+Enter repeatedly.
2. A match that is already on screen (and not under the widget / sticky headers / last row) does **not** scroll.
3. A match on the **last visible row** (where the bottom active-line bar appears) is scrolled to the middle instead of
   being hidden behind the bar; the bottom bar is not shown for the current match.
4. A match above the viewport, or under the Find widget / sticky headers, is scrolled to the middle.

## 5. Sticky header click
1. Scroll deep inside nested blocks so 2–4 headers are pinned (Find closed).
2. Tap each header in turn → the editor scrolls so that line sits **directly under the remaining headers** as a normal
   row; it is not pinned any more. Repeat on a device with fractional DPR (Pixel / Samsung, 2.6–2.75).
3. Tapping the bottom active-line bar still centres that line.
