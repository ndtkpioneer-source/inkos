import type { InteractionRequest } from "./intents.js";

export interface NaturalLanguageRoutingContext {
  readonly activeBookId?: string;
  readonly hasCreationDraft?: boolean;
  readonly hasFailed?: boolean;
}

export function routeNaturalLanguageIntent(
  input: string,
  context: NaturalLanguageRoutingContext = {},
): InteractionRequest {
  const trimmed = input.trim();
  const bookId = context.activeBookId;

  // This router is now an explicit command parser only. Natural-language
  // intent belongs to the agent layer; regex here must not execute pipelines.
  if (/^\/write$/i.test(trimmed)) {
    return {
      intent: "write_next",
      ...(bookId ? { bookId } : {}),
    };
  }

  if (/^\/books$/i.test(trimmed)) {
    return {
      intent: "list_books",
    };
  }

  const newCommand = trimmed.match(/^\/new\s+(.+)$/i);
  if (newCommand) {
    return {
      intent: "develop_book",
      instruction: newCommand[1]!.trim(),
    };
  }

  if (/^\/create$/i.test(trimmed)) {
    return {
      intent: "create_book",
      ...(bookId ? { bookId } : {}),
    };
  }

  if (/^\/draft$/i.test(trimmed)) {
    return {
      intent: "show_book_draft",
    };
  }

  if (/^\/discard$/i.test(trimmed)) {
    return {
      intent: "discard_book_draft",
    };
  }

  const openCommand = trimmed.match(/^\/open\s+(.+)$/i);
  if (openCommand) {
    return {
      intent: "select_book",
      bookId: openCommand[1]!.trim(),
    };
  }

  if (/^\/pause$/i.test(trimmed)) {
    return {
      intent: "pause_book",
      ...(bookId ? { bookId } : {}),
    };
  }

  const modeCommand = trimmed.match(/^\/mode\s+(auto|semi|manual)$/i);
  if (modeCommand) {
    return {
      intent: "switch_mode",
      mode: modeCommand[1]!.toLowerCase() as "auto" | "semi" | "manual",
    };
  }

  const slashRewrite = trimmed.match(/^\/rewrite\s+(\d+)$/i);
  if (slashRewrite) {
    return {
      intent: "rewrite_chapter",
      ...(bookId ? { bookId } : {}),
      chapterNumber: parseInt(slashRewrite[1]!, 10),
    };
  }

  const slashFocus = trimmed.match(/^\/focus\s+(.+)$/i);
  if (slashFocus) {
    return {
      intent: "update_focus",
      ...(bookId ? { bookId } : {}),
      instruction: slashFocus[1]!.trim(),
    };
  }

  const slashTruth = trimmed.match(/^\/truth\s+([^\s]+)\s+([\s\S]+)$/i);
  if (slashTruth) {
    return {
      intent: "edit_truth",
      ...(bookId ? { bookId } : {}),
      fileName: slashTruth[1]!.trim(),
      instruction: slashTruth[2]!.trim(),
    };
  }

  const slashRename = trimmed.match(/^\/rename\s+(.+?)\s*=>\s*(.+)$/i);
  if (slashRename) {
    return {
      intent: "rename_entity",
      ...(bookId ? { bookId } : {}),
      oldValue: slashRename[1]!.trim(),
      newValue: slashRename[2]!.trim(),
    };
  }

  const slashReplace = trimmed.match(/^\/replace\s+(\d+)\s+(.+?)\s*=>\s*(.+)$/i);
  if (slashReplace) {
    return {
      intent: "patch_chapter_text",
      ...(bookId ? { bookId } : {}),
      chapterNumber: parseInt(slashReplace[1]!, 10),
      targetText: slashReplace[2]!.trim(),
      replacementText: slashReplace[3]!.trim(),
    };
  }

  const slashExport = trimmed.match(/^\/export(?:\s+(txt|md|epub))?$/i);
  if (slashExport) {
    return {
      intent: "export_book",
      ...(bookId ? { bookId } : {}),
      format: (slashExport[1]?.toLowerCase() as "txt" | "md" | "epub" | undefined) ?? "txt",
    };
  }

  if (context.hasCreationDraft) {
    return {
      intent: "develop_book",
      instruction: trimmed,
    };
  }

  return {
    intent: "chat",
    ...(bookId ? { bookId } : {}),
    instruction: trimmed,
  };
}
