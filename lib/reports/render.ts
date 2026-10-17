import type { ComparisonSnapshot } from "../contracts/snapshot";
import { buildComparisonReportModel, type ReportModelOptions } from "./model";

export interface ComparisonReportRenderOptions extends ReportModelOptions {
  /** Browser-local public paths. Node callers should provide absolute paths. */
  fonts?: { basic: string; extended: string; devanagari: string };
}

export class ComparisonReportError extends Error {
  readonly code: "invalid_snapshot" | "unsupported_lender_glyph" | "unsupported_report_glyph" | "font_unavailable" | "render_failed";

  constructor(code: ComparisonReportError["code"], message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ComparisonReportError";
    this.code = code;
  }
}

const browserFonts = {
  basic: "/fonts/report/TrueCostSans-Basic.woff",
  extended: "/fonts/report/TrueCostSans-Latin.woff",
  devanagari: "/fonts/report/TrueCostSans-Devanagari.woff",
};

export async function renderComparisonReport(
  input: ComparisonSnapshot | string | unknown,
  options: ComparisonReportRenderOptions = {},
): Promise<Blob> {
  let model;
  try {
    model = buildComparisonReportModel(input, options);
  } catch (error) {
    throw new ComparisonReportError("invalid_snapshot", "The comparison snapshot is not valid.", { cause: error });
  }
  if (model.glyphCoverage.unsupportedTextCharacters.length) {
    throw new ComparisonReportError(
      "unsupported_report_glyph",
      `A lender or fee label contains unsupported characters: ${model.glyphCoverage.unsupportedTextCharacters.join("")}`,
    );
  }
  const fonts = options.fonts ?? browserFonts;
  try {
    const [{ pdf }, { ComparisonReportDocument }] = await Promise.all([
      import("@react-pdf/renderer"),
      import("./document"),
    ]);
    return await pdf(ComparisonReportDocument({ model, fonts })).toBlob();
  } catch (error) {
    if (error instanceof Error && error.message.includes("not found")) {
      throw new ComparisonReportError("font_unavailable", "The local report font could not be loaded.", { cause: error });
    }
    throw new ComparisonReportError("render_failed", "The report could not be generated.", { cause: error });
  }
}
