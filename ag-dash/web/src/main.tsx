import { createRoot } from "react-dom/client";
import "./styles.css";
import { useBoard } from "./state/board";
import { start } from "./state/sync";
import { useTx } from "./state/tx";
import { useUi } from "./state/ui";
import { App, installGlobal } from "./ui/App";
import { installKeys } from "./ui/keyboard";

installGlobal();
// For debugging from the console (and the tests): the stores.
(window as any).agDash = { useBoard, useTx, useUi };
void installKeys();
void start();
createRoot(document.getElementById("root")!).render(<App />);
