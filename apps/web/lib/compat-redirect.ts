import { redirect } from "next/navigation";
import {
  compatRoute,
  type CompatRouteOverrides,
  type CompatSearchParams,
} from "./compat-route";

export type CompatRedirectPageProps = {
  searchParams?: Promise<CompatSearchParams>;
};

export type CompatRedirectPage = (
  props: CompatRedirectPageProps,
) => Promise<never>;

export function createCompatRedirectPage(
  pathname: string,
  overrides: CompatRouteOverrides,
): CompatRedirectPage {
  return async function CompatRedirectPage({
    searchParams,
  }: CompatRedirectPageProps): Promise<never> {
    redirect(compatRoute(pathname, (await searchParams) ?? {}, overrides));
  };
}
