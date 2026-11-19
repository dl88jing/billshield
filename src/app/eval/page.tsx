import results from "../../../public/eval/results.json";
import cloudRaw from "../../../public/eval/cloud.json";
import history from "../../../public/eval/cloud-history.json";
import EvalView, { type Cloud, type Results, type HistoryRun } from "./eval-view";

export const metadata = { title: "BillShield · Measured results" };

// Server component: reads the committed eval JSON at build time; the client view localizes the labels (EN/ES/JA).
export default function Eval() {
  return <EvalView r={results as Results} cloud={cloudRaw as Cloud} history={history as HistoryRun[]} />;
}
