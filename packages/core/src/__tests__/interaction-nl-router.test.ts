import { describe, expect, it } from "vitest";
import { routeNaturalLanguageIntent } from "../interaction/nl-router.js";

describe("interaction natural-language router", () => {
  it("does not execute natural-language commands by regex", () => {
    expect(routeNaturalLanguageIntent("continue", { activeBookId: "harbor" })).toEqual({
      intent: "chat",
      bookId: "harbor",
      instruction: "continue",
    });
    expect(routeNaturalLanguageIntent("继续写", { activeBookId: "harbor" })).toEqual({
      intent: "chat",
      bookId: "harbor",
      instruction: "继续写",
    });
    expect(routeNaturalLanguageIntent("pause this book", { activeBookId: "harbor" })).toEqual({
      intent: "chat",
      bookId: "harbor",
      instruction: "pause this book",
    });
    expect(routeNaturalLanguageIntent("rewrite chapter 3", { activeBookId: "harbor" })).toEqual({
      intent: "chat",
      bookId: "harbor",
      instruction: "rewrite chapter 3",
    });
    expect(routeNaturalLanguageIntent("把陆尘改成林砚", { activeBookId: "harbor" })).toEqual({
      intent: "chat",
      bookId: "harbor",
      instruction: "把陆尘改成林砚",
    });
    expect(routeNaturalLanguageIntent("导出全书为 epub", { activeBookId: "harbor" })).toEqual({
      intent: "chat",
      bookId: "harbor",
      instruction: "导出全书为 epub",
    });
  });

  it("routes freeform input into chat unless an explicit draft is active", () => {
    expect(routeNaturalLanguageIntent("我想写个港风商战悬疑")).toEqual({
      intent: "chat",
      instruction: "我想写个港风商战悬疑",
    });
    expect(routeNaturalLanguageIntent("先不要开书，我想想名字", {
      hasCreationDraft: true,
    })).toEqual({
      intent: "develop_book",
      instruction: "先不要开书，我想想名字",
    });
    expect(routeNaturalLanguageIntent("名字再狠一点", {
      activeBookId: "harbor",
      hasCreationDraft: true,
    })).toEqual({
      intent: "develop_book",
      instruction: "名字再狠一点",
    });
  });

  it("maps slash commands for direct control", () => {
    expect(routeNaturalLanguageIntent("/books", { activeBookId: "harbor" })).toEqual({
      intent: "list_books",
    });
    expect(routeNaturalLanguageIntent("/new Night Harbor", { activeBookId: "harbor" })).toEqual({
      intent: "develop_book",
      instruction: "Night Harbor",
    });
    expect(routeNaturalLanguageIntent("/create", { hasCreationDraft: true })).toEqual({
      intent: "create_book",
    });
    expect(routeNaturalLanguageIntent("/draft", { hasCreationDraft: true })).toEqual({
      intent: "show_book_draft",
    });
    expect(routeNaturalLanguageIntent("/discard", { hasCreationDraft: true })).toEqual({
      intent: "discard_book_draft",
    });
    expect(routeNaturalLanguageIntent("/open beta", { activeBookId: "harbor" })).toEqual({
      intent: "select_book",
      bookId: "beta",
    });
    expect(routeNaturalLanguageIntent("/pause", { activeBookId: "harbor" })).toEqual({
      intent: "pause_book",
      bookId: "harbor",
    });
    expect(routeNaturalLanguageIntent("/write", { activeBookId: "harbor" })).toEqual({
      intent: "write_next",
      bookId: "harbor",
    });
    expect(routeNaturalLanguageIntent("/mode auto", { activeBookId: "harbor" })).toEqual({
      intent: "switch_mode",
      mode: "auto",
    });
    expect(routeNaturalLanguageIntent("/rewrite 3", { activeBookId: "harbor" })).toEqual({
      intent: "rewrite_chapter",
      bookId: "harbor",
      chapterNumber: 3,
    });
    expect(routeNaturalLanguageIntent("/focus bring it back to the old case", { activeBookId: "harbor" })).toEqual({
      intent: "update_focus",
      bookId: "harbor",
      instruction: "bring it back to the old case",
    });
    expect(routeNaturalLanguageIntent("/truth current_focus.md Bring it back", { activeBookId: "harbor" })).toEqual({
      intent: "edit_truth",
      bookId: "harbor",
      fileName: "current_focus.md",
      instruction: "Bring it back",
    });
    expect(routeNaturalLanguageIntent("/rename 陆尘 => 林砚", { activeBookId: "harbor" })).toEqual({
      intent: "rename_entity",
      bookId: "harbor",
      oldValue: "陆尘",
      newValue: "林砚",
    });
    expect(routeNaturalLanguageIntent("/replace 3 旧名字 => 新名字", { activeBookId: "harbor" })).toEqual({
      intent: "patch_chapter_text",
      bookId: "harbor",
      chapterNumber: 3,
      targetText: "旧名字",
      replacementText: "新名字",
    });
    expect(routeNaturalLanguageIntent("/export", { activeBookId: "harbor" })).toEqual({
      intent: "export_book",
      bookId: "harbor",
      format: "txt",
    });
    expect(routeNaturalLanguageIntent("/export md", { activeBookId: "harbor" })).toEqual({
      intent: "export_book",
      bookId: "harbor",
      format: "md",
    });
  });

  it("falls back to chat for unmatched freeform input", () => {
    expect(routeNaturalLanguageIntent("没有动效没有回答", { activeBookId: "harbor" })).toEqual({
      intent: "chat",
      bookId: "harbor",
      instruction: "没有动效没有回答",
    });
  });
});
