// app/unlock/page.tsx
import UnlockClient from "./UnlockClient";

export const metadata = { title: "Unlock • Goolets AI Agent" };

export default function Page({ searchParams }: { searchParams: { redirect?: string } }) {
  const redirect = searchParams?.redirect || "/";
  return <UnlockClient redirect={redirect} />;
}
