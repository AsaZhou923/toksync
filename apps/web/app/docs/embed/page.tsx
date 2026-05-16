import { apiUrl } from "../../../lib/api";

export default function EmbedDocsPage() {
  const badge = `${apiUrl("/v1/badge/demo.svg")}?metric=tokens`;
  const card = `${apiUrl("/v1/embed/demo.svg")}?theme=dark`;
  return (
    <div className="grid">
      <h1>README embed</h1>
      <div className="command">{`![TokSync](${badge})`}</div>
      <div className="command">{`![TokSync profile](${card})`}</div>
    </div>
  );
}
