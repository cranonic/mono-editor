// Browser stand-in for Node's `util`: `vscode-emmet-helper` imports `{ TextDecoder }` from it
// (only used to read custom Emmet snippet files, which we never load) and Vite would otherwise
// externalize the module and break the named import.
export const TextDecoder = globalThis.TextDecoder;
export default { TextDecoder };
