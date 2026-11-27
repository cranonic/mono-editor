import * as monaco from '@/core/mono';
import { usePaletteStore, type QuickPickItem } from '@/store/paletteStore';
import { useStatusBarStore } from '../store/statusBarStore';
import { configRegistry } from '@/core/extensionAPI/registry/configurationRegistry';

export const handleEOLClick = (editor: monaco.editor.IStandaloneCodeEditor) => {
  const model = editor.getModel?.();
  if (!model) return;

  const currentEOL = model.getEOL?.() ?? '\n';
  const settingDef = configRegistry.getSetting('files.eol');
  const rawEnum = settingDef?.enum?.length ? settingDef.enum : ['\n', '\r\n'];
  const rawLabels = settingDef?.enumItemLabels?.length ? settingDef.enumItemLabels : ['LF (\\n)', 'CRLF (\\r\\n)'];

  const items: QuickPickItem[] = rawEnum.map((val, idx) => {
    const label = rawLabels[idx] || (val === '\r\n' ? 'CRLF' : 'LF');
    const isCurrent = (val === '\n' && currentEOL === '\n') || (val === '\r\n' && currentEOL === '\r\n');

    return {
      id: String(val),
      label,
      suffix: isCurrent ? ' - current' : '',
      onSelect: () => {
        if (val === '\n') {
          model.setEOL?.(monaco.EndOfLineSequence.LF);
          useStatusBarStore.getState().updateItem('eol', { label: 'LF' });
        } else if (val === '\r\n') {
          model.setEOL?.(monaco.EndOfLineSequence.CRLF);
          useStatusBarStore.getState().updateItem('eol', { label: 'CRLF' });
        }
        editor.focus?.();
      },
    };
  });

  setTimeout(() => {
    usePaletteStore.getState().openQuickPick(
      'Select End of Line Sequence',
      items,
      (selected) => { if (selected.onSelect) selected.onSelect(); }
    );
  }, 50);
};