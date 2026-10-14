// Browser fixtures use the same Vite module graph as production extensions.
export {EditorView} from "@codemirror/view";
export {EditorState} from "@codemirror/state";
export {basicSetup} from "codemirror";
export {indentUnit} from "@codemirror/language";
export {acceptCompletion,completionStatus,selectedCompletionIndex} from "@codemirror/autocomplete";
export {rust} from "@codemirror/lang-rust";
export {indentGuides,indentationColumns} from "../src/indent-guides";
export {languageIntelligence,completionChanges} from "../src/intelligence";
