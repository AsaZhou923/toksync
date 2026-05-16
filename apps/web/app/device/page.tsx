import { DeviceAuthorizeForm } from "../../components/DeviceAuthorizeForm";

export default function DevicePage() {
  return (
    <div className="grid">
      <header className="page-head">
        <div>
          <p className="page-kicker">cli login</p>
          <h1>Authorize device</h1>
        </div>
      </header>
      <DeviceAuthorizeForm />
    </div>
  );
}
