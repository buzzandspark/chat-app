"use client";
// Every dialog loads from this one module, so Radix's dialog primitives ship in a single chunk.
export { SearchDialog } from "./search-dialog";
export { RenameDialog } from "./rename-dialog";
export { DeleteDialog } from "./delete-dialog";
export { DeclareWinnerDialog } from "./declare-winner-dialog";
export { DeleteForksDialog } from "./delete-forks-dialog";
export { DeleteAllDialog } from "./delete-all-dialog";
export type { ChatDialogProps } from "./dialog-props";
