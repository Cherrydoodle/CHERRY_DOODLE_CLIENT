import type { Metadata } from "next";

import { AuthForm } from "../auth-form";

export const metadata: Metadata = { title: "Choose a new password", robots: { index: false } };

export default function ResetPasswordPage() {
  return <AuthForm mode="reset" />;
}
