import type { Metadata } from "next";

import { AuthForm } from "../auth-form";

export const metadata: Metadata = { title: "Reset password", robots: { index: false } };

export default function ForgotPasswordPage() {
  return <AuthForm mode="forgot" />;
}
