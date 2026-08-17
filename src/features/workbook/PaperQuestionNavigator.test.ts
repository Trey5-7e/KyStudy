import { describe, expect, it } from "vitest";

import {
  paperQuestionOverviewClassName,
  paperQuestionOverviewResultLabel,
} from "./PaperQuestionNavigator";

describe("paper question overview", () => {
  it("maps result states to readable labels", () => {
    expect(paperQuestionOverviewResultLabel(undefined)).toBe("未作答");
    expect(paperQuestionOverviewResultLabel("correct")).toBe("做对");
    expect(paperQuestionOverviewResultLabel("uncertain")).toBe("不全对");
    expect(paperQuestionOverviewResultLabel("incorrect")).toBe("做错");
  });

  it("adds a result class without hiding the active state", () => {
    expect(paperQuestionOverviewClassName(undefined, false)).toBe("");
    expect(paperQuestionOverviewClassName("correct", false)).toBe(
      "has-result-correct",
    );
    expect(paperQuestionOverviewClassName("uncertain", true)).toBe(
      "is-active has-result-uncertain",
    );
    expect(paperQuestionOverviewClassName("incorrect", true)).toBe(
      "is-active has-result-incorrect",
    );
  });
});
