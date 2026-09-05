import { createCompatRedirectPage } from "../../../lib/compat-redirect";

export default createCompatRedirectPage("/app/settings", {
  tab: "data",
  view: "vault",
});
