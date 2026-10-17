import type { ReactNode } from "react";
import { HistoryProvider } from "@/lib/comparison/history-provider";

export default function ComparisonsLayout({ children }: { children: ReactNode }) {
  return <HistoryProvider>{children}</HistoryProvider>;
}
