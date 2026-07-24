import type { Metadata } from "next";

import { LegalPage, LegalSection } from "@/components/legal/legal-page";
import { getStoreIdentity } from "@/features/store/identity";

import { ContactForm } from "./contact-form";

export const metadata: Metadata = {
  title: "Contact Us",
  description: "Get in touch with Cherry Doodle — email, phone, and a contact form for order support.",
};

export default async function ContactPage() {
  const store = await getStoreIdentity();
  return (
    <LegalPage
      title="Contact Us"
      intro="Questions about an order, a return, or anything else? We're happy to help."
    >
      <LegalSection heading="Reach us directly">
        <p>
          Email: <a className="text-primary hover:underline" href={`mailto:${store.email}`}>{store.email}</a>
          <br />
          Phone: <a className="text-primary hover:underline" href={`tel:${store.phone.replace(/\s+/g, "")}`}>{store.phone}</a>
          <br />
          WhatsApp: <a className="text-primary hover:underline" href={`https://wa.me/${store.phone.replace(/\D/g, "")}`} target="_blank" rel="noopener noreferrer">{store.phone}</a>
          {store.instagram ? (
            <>
              <br />
              Instagram: <a className="text-primary hover:underline" href={store.instagram} target="_blank" rel="noopener noreferrer">@cherry__doodle</a>
            </>
          ) : null}
          <br />
          Support hours: 10:00–20:00 IST, all days.
          <br />
          {store.address}
        </p>
      </LegalSection>
      <LegalSection heading="Send us a message">
        <ContactForm />
      </LegalSection>
    </LegalPage>
  );
}
