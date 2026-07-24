import type { Metadata } from "next";

import { AuthForm } from "../auth-form";

export const metadata: Metadata = { title: "Create account", robots: { index: false } };

export default function RegisterPage() {
  return <AuthForm mode="register" />;
}
