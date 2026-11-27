// src/features/explorer/components/Symbols/SymbolsPanel.tsx
import React, { useEffect, useState } from 'react';
import * as monaco from '@/core/mono';
import { type DocumentSymbol } from '@/core/symbols'; 
import { getSymbolTree, getActiveEditor } from '@/core/services/symbolService';
import { useTabStore } from '@/store/tabStore';
import { SymbolNode } from './components/SymbolNode';

interface SymbolsPanelProps {
  onSourceLoaded?: (source: string | null) => void;
}

export const SymbolsPanel: React.FC<SymbolsPanelProps> = ({ onSourceLoaded }) => {
  const [symbols, setSymbols] = useState<DocumentSymbol[]>([]);
  const [loading, setLoading] = useState(false);
  const { activeTabId } = useTabStore();

  useEffect(() => {
    let alive = true;
    const fetchSymbols = async () => {
      setLoading(true);
      const editor = getActiveEditor();
      if (editor && editor.getModel()) {
        const tree = await getSymbolTree(editor.getModel()!);
        if (alive) {
          setSymbols(tree);
          // send to parent after getting first item's source
          if (onSourceLoaded) onSourceLoaded(tree.length > 0 ? tree[0].source || null : null);
        }
      } else {
        if (alive) {
          setSymbols([]);
          if (onSourceLoaded) onSourceLoaded(null);
        }
      }
      if (alive) setLoading(false);
    };

    fetchSymbols();

    const editor = getActiveEditor();
    let listener: monaco.IDisposable | null = null;
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    const scheduleRefresh = () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        debounceTimer = null;
        if (alive) void fetchSymbols();
      }, 1000);
    };
    const model = editor?.getModel();
    if (model && typeof model.onDidChangeContent === 'function') {
      listener = model.onDidChangeContent(scheduleRefresh);
    } else if (editor && typeof editor.onDidChangeModelContent === 'function') {
      listener = editor.onDidChangeModelContent(scheduleRefresh);
    }

    return () => {
      alive = false;
      if (debounceTimer) clearTimeout(debounceTimer);
      if (listener) listener.dispose();
    };
  }, [activeTabId]); 

  if (loading && symbols.length === 0) return <div style={{ padding: '10px 20px', fontSize: '12px', color: 'var(--ms-text-faded)' }}>Loading...</div>;
  if (symbols.length === 0) return <div style={{ padding: '10px 20px', fontSize: '12px', color: 'var(--ms-text-faded)' }}>No symbols found.</div>;

  return (
    <div style={{ padding: '4px 0', display: 'flex', flexDirection: 'column' }}>
      {symbols.map((sym, idx) => (
        <SymbolNode key={idx} symbol={sym} />
      ))}
    </div>
  );
};