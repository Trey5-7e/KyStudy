export interface WorkbookPdfAdaptationProfile {
  id: string;
  allowUnpunctuatedQuestionNumbers: boolean;
  /**
   * Prefer plain body evidence over parenthesized when both appear on a page.
   * Books whose answer areas are saturated with "(1)" blank labels need this
   * so the blank labels cannot mask the real unpunctuated question markers.
   */
  plainBeforeParenthesized?: boolean;
}

const DEFAULT_PROFILE: WorkbookPdfAdaptationProfile = {
  id: "generic-text-pdf",
  allowUnpunctuatedQuestionNumbers: true,
};

const PROFILE_RULES: ReadonlyArray<{
  profile: WorkbookPdfAdaptationProfile;
  titlePattern: RegExp;
}> = [
  {
    profile: {
      id: "li-yongle-660-gaoshu",
      allowUnpunctuatedQuestionNumbers: true,
    },
    titlePattern: /660.*高数|高数.*660/i,
  },
  {
    profile: {
      id: "li-yongle-660-xiangai",
      allowUnpunctuatedQuestionNumbers: true,
      plainBeforeParenthesized: true,
    },
    titlePattern: /660.*(线概|线代概率)|(线概|线代概率).*660/i,
  },
  {
    profile: {
      id: "li-yanfang-900-shuyi-gaoshu",
      allowUnpunctuatedQuestionNumbers: true,
    },
    titlePattern: /900.*数一.*高数|数一.*高数.*900/i,
  },
  {
    profile: {
      id: "li-yanfang-900-shuyi-xiandai-gailv",
      allowUnpunctuatedQuestionNumbers: true,
    },
    titlePattern: /900.*数一.*(线代概率|线概)|数一.*(线代概率|线概).*900/i,
  },
  {
    profile: {
      id: "zhang-yu-1000-shuyi-gaoshu",
      allowUnpunctuatedQuestionNumbers: true,
    },
    titlePattern: /1000题.*高数|高数.*1000题/i,
  },
  {
    profile: {
      id: "zhang-yu-1000-shuyi-xiandai-gailv",
      allowUnpunctuatedQuestionNumbers: true,
    },
    titlePattern: /1000题.*(线概|线代概率)|(线概|线代概率).*1000题/i,
  },
];

export function resolveWorkbookPdfProfile(
  title: string,
): WorkbookPdfAdaptationProfile {
  const rule = PROFILE_RULES.find(({ titlePattern }) =>
    titlePattern.test(title),
  );
  return rule?.profile ?? DEFAULT_PROFILE;
}
