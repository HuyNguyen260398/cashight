import type { ReactNode } from "react";
import { auth, signOut } from "@/auth";
import { AdminShell } from "./admin-shell";

export async function Nav({ children }: { children: ReactNode }) {
  const session = await auth();
  const email = session?.user?.email;

  async function signOutAction() {
    "use server";
    await signOut({ redirectTo: "/signin" });
  }

  if (!email) {
    return <>{children}</>;
  }

  return (
    <AdminShell email={email} signOutAction={signOutAction}>
      {children}
    </AdminShell>
  );
}
