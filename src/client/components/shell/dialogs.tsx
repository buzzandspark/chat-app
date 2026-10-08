"use client";
// #82: every dialog loads from this one module, so Radix's dialog primitives ship in a single chunk.
export { SearchDialog } from "./search-dialog";
export { FeedbackDialog } from "./feedback-dialog";
export { DeleteDialog, DeleteGroupDialog, GroupNameDialog, RenameDialog } from "./chat-dialogs";
