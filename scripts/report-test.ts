// Smoke test locale del report email.
import { getOverview } from "@/features/analytics/service.js";
import { renderReportHtml } from "@/features/analytics/report.js";
import fs from "fs";

async function main() {
  const o = await getOverview("yesterday");
  const html = renderReportHtml(o, "mercoledi 11 giugno");
  fs.writeFileSync("/tmp/kyron-report-test.html", html);
  console.log("written", html.length, "bytes | visitors:", o.totals.visitors, "| pages:", o.pages.length, "| devices:", o.devices.map((d) => d.device).join(","));
}
void main();
