import {
  apiGet,
  ApiRequestError,
  USER,
  type CostGuardrailsResponse,
} from "../../../lib/api";
import { CostGuardrailsConsole } from "../../../components/CostGuardrailsConsole";

export const dynamic = "force-dynamic";

export default async function GuardrailsPage() {
  let data: CostGuardrailsResponse = { rules: [], anomalies: [] };
  let available = true;

  try {
    data =
      (await apiGet<CostGuardrailsResponse>("/v1/cost-guardrails", {
        notFoundAsNull: false,
      })) ?? data;
  } catch (error) {
    if (
      error instanceof ApiRequestError &&
      (error.status === 404 || error.status === 501)
    ) {
      available = false;
    } else {
      throw error;
    }
  }

  return (
    <div className="grid">
      <header className="page-head">
        <div>
          <p className="page-kicker">private cost governance</p>
          <h1>Cost Guardrails</h1>
          <p className="lede">
            Set budget thresholds across all private usage or by source, model,
            and device, then review anomaly summaries for spikes, unknown
            pricing, and budget drift without exposing private operational
            details.
          </p>
        </div>
      </header>
      <CostGuardrailsConsole
        available={available}
        initialData={data}
        username={USER}
      />
    </div>
  );
}
