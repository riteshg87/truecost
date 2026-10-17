import React from "react";
import {
  Document,
  Font,
  Page,
  StyleSheet,
  Text,
  View,
} from "@react-pdf/renderer";
import type { ComparisonReportModel } from "./model";

export interface ReportFontSources {
  basic: string;
  extended: string;
  devanagari: string;
}

const styles = StyleSheet.create({
  page: {
    paddingTop: 38,
    paddingBottom: 42,
    paddingHorizontal: 38,
    fontSize: 9,
    color: "#20252b",
    fontFamily: "TrueCostReportBasic",
  },
  header: { marginBottom: 18 },
  title: { fontSize: 22, marginBottom: 4, fontWeight: 700 },
  meta: { color: "#5d6670", fontSize: 8, marginBottom: 2 },
  section: { marginBottom: 15 },
  sectionTitle: { fontSize: 12, fontWeight: 700, marginBottom: 7 },
  offer: { marginBottom: 13, paddingBottom: 10, borderBottom: "1 solid #d8dde2" },
  offerHeading: { fontSize: 12, fontWeight: 700, marginBottom: 3 },
  best: { color: "#155e45" },
  row: { flexDirection: "row", marginBottom: 3 },
  label: { width: 126, color: "#5d6670" },
  value: { flexGrow: 1 },
  warning: { marginBottom: 4, paddingLeft: 8 },
  caution: { color: "#8a4b08" },
  note: { marginBottom: 4, lineHeight: 1.25 },
  footer: { position: "absolute", bottom: 18, left: 38, right: 38, fontSize: 7, color: "#68727c", textAlign: "center" },
});

const registered = new Set<string>();

function registerFonts(sources: ReportFontSources): void {
  const key = `${sources.basic}|${sources.extended}|${sources.devanagari}`;
  if (registered.has(key)) return;
  Font.register({ family: "TrueCostReportBasic", src: sources.basic, fontWeight: 400 });
  Font.register({ family: "TrueCostReportBasic", src: sources.basic, fontWeight: 700 });
  Font.register({ family: "TrueCostReportExtended", src: sources.extended, fontWeight: 400 });
  Font.register({ family: "TrueCostReportExtended", src: sources.extended, fontWeight: 700 });
  Font.register({ family: "TrueCostReportDevanagari", src: sources.devanagari, fontWeight: 400 });
  Font.register({ family: "TrueCostReportDevanagari", src: sources.devanagari, fontWeight: 700 });
  Font.registerHyphenationCallback((word) => [word]);
  registered.add(key);
}

function runs(value: string): React.ReactNode[] {
  const children: React.ReactNode[] = [];
  let current = "";
  let family = "TrueCostReportBasic";
  const flush = () => {
    if (current) children.push(<Text key={`${children.length}-${current}`} style={{ fontFamily: family }}>{current}</Text>);
    current = "";
  };
  for (const character of [...value]) {
    const code = character.codePointAt(0) ?? 0;
    const next = code >= 0x0900 && code <= 0x097f
      ? "TrueCostReportDevanagari"
      : code === 0x20b9
        ? "TrueCostReportExtended"
        : "TrueCostReportBasic";
    if (current && next !== family) flush();
    family = next;
    current += character;
  }
  flush();
  return children;
}

function DynamicText({ value, style }: { value: string; style?: any }) {
  return <Text style={style}>{runs(value)}</Text>;
}

function KeyValue({ label, value }: { label: string; value: string }) {
  return <View style={styles.row}><Text style={styles.label}>{label}</Text><DynamicText value={value} style={styles.value} /></View>;
}

export function ComparisonReportDocument({ model, fonts }: { model: ComparisonReportModel; fonts: ReportFontSources }) {
  registerFonts(fonts);
  if (model.glyphCoverage.unsupportedTextCharacters.length) {
    throw new Error(`unsupported_report_glyph:${model.glyphCoverage.unsupportedTextCharacters.join("")}`);
  }
  return (
    <Document title={model.title} author="TrueCost" subject="Comparison report">
      <Page size="A4" style={styles.page} wrap>
        <View style={styles.header}>
          <Text style={styles.title}>{model.title}</Text>
          <Text style={styles.meta}>Generated {model.generatedAt}</Text>
          <Text style={styles.meta}>Snapshot {model.resultId} - created {model.createdAt}</Text>
          <Text style={styles.meta}>Snapshot schema {model.snapshotVersion} - calculation {model.calculationVersion} - report {model.reportVersion}</Text>
        </View>
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Offers</Text>
          {model.offers.map((offer) => (
            <View key={offer.offerId} style={styles.offer} minPresenceAhead={220}>
              <Text style={[styles.offerHeading, offer.isBest ? styles.best : undefined]}>
                {offer.rank}) <DynamicText value={offer.lender} />{offer.isBest ? " - Lowest APR" : ""}
              </Text>
              <KeyValue label="Loan amount" value={offer.amount} />
              <KeyValue label="Tenure" value={offer.tenure} />
              <KeyValue label="Quoted rate" value={`${offer.quotedRate} - ${offer.rateType} - ${offer.rateStructure}`} />
              <KeyValue label="Processing fee" value={offer.processingFee} />
              <KeyValue label="GST" value={offer.gst} />
              <KeyValue label="Insurance" value={offer.insurance} />
              <KeyValue label="Other fees" value={offer.otherFees} />
              <KeyValue label="Upfront fees" value={offer.upfrontFees} />
              <KeyValue label="Monthly EMI" value={offer.emi} />
              <KeyValue label="Total repayment" value={offer.totalRepayment} />
              <KeyValue label="Total interest" value={offer.totalInterest} />
              <KeyValue label="Total borrowing cost" value={offer.totalCostOfBorrowing} />
              <KeyValue label="Cost per lakh" value={offer.costPerLakh} />
              <KeyValue label="Effective APR" value={offer.apr} />
              {offer.aprUnavailableReason ? <Text style={[styles.note, styles.caution]}>APR reason: <DynamicText value={offer.aprUnavailableReason} /></Text> : null}
              {offer.warnings.map((warning) => <Text key={`${offer.offerId}-${warning.code}`} style={[styles.warning, warning.level === "caution" ? styles.caution : undefined]}><DynamicText value={`${warning.level === "caution" ? "Caution: " : "Note: "}${warning.message}`} /></Text>)}
            </View>
          ))}
        </View>
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Assumptions and warnings</Text>
          {model.assumptions.map((warning) => <Text key={warning.code} style={[styles.note, warning.level === "caution" ? styles.caution : undefined]}><DynamicText value={warning.message} /></Text>)}
        </View>
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Important</Text>
          <Text style={styles.note}>{model.disclaimer}</Text>
        </View>
        <Text fixed style={styles.footer} render={({ pageNumber, totalPages }) => `TrueCost - Page ${pageNumber} of ${totalPages}`} />
      </Page>
    </Document>
  );
}
