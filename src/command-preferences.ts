import {createContext} from "react";
import type {Command} from "./command-registry";
import type {UserKeybindings} from "./keybindings";
export type WorkbenchCommand=Command<void>;
export const CommandPreferences=createContext<{bindings:UserKeybindings;commands:WorkbenchCommand[]}>({bindings:{},commands:[]});
