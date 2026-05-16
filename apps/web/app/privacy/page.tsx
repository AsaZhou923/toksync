export default function PrivacyPage() {
  return (
    <div className="grid">
      <h1>Privacy</h1>
      <p className="lede">
        TokSync v0.1 stores token counts, estimated cost, model, source, date,
        device id and hashed workspace keys. It does not upload prompts,
        responses, tool arguments, tool output or file content.
      </p>
    </div>
  );
}
