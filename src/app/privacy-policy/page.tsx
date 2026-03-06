import type { Metadata } from "next";
import Link from "next/link";
import {
  LEGAL_LAST_UPDATED,
  LegalPage,
  type LegalSection,
} from "@/components/legal-page";

export const metadata: Metadata = {
  title: "Privacy Policy | Send Again",
  description:
    "Privacy Policy for Send Again, describing what data is collected, how it is used, and how uploaded contact data is handled.",
};

const sections: LegalSection[] = [
  {
    title: "1. Scope",
    paragraphs: [
      "This Privacy Policy explains how Send Again collects, uses, stores, and shares personal data when you use the website, application, APIs, and related services.",
      "It applies to information related to account holders, workspace members, billing contacts, website visitors, and the contact data you upload or process through the service.",
    ],
  },
  {
    title: "2. Data we collect",
    paragraphs: ["The information we collect depends on how you use Send Again."],
    bullets: [
      "Account data, such as email address, login activity, and authentication metadata.",
      "Workspace data, such as sending domains, from names, footer content, contacts, campaign templates, send history, and unsubscribe records.",
      "Billing and transaction data, such as plan, credits, invoices, payment status, and customer identifiers from payment providers.",
      "Technical and usage data, such as logs, IP address, browser data, API activity, device details, and operational telemetry.",
      "Support or feedback data you choose to send when contacting us.",
    ],
  },
  {
    title: "3. How we use personal data",
    bullets: [
      "To provide and secure the product, including authentication, workspace access, email sending, and suppression handling.",
      "To operate analytics, delivery, billing, abuse prevention, troubleshooting, and customer support workflows.",
      "To improve the service, develop new features, and monitor reliability, performance, and fraud risk.",
      "To comply with legal obligations, enforce our terms, and protect users, recipients, and the platform.",
    ],
  },
  {
    title: "4. Your responsibility for contact data",
    paragraphs: [
      "When you upload contacts or send campaigns, you control the recipient data and message content processed through Send Again. In that context, you are responsible for providing appropriate notices, obtaining any required consent, and honoring recipient rights.",
      "We process that data on your behalf to deliver the service, including transmission, event tracking, unsubscribe handling, and operational support.",
    ],
  },
  {
    title: "5. Service providers and sharing",
    paragraphs: [
      "We share personal data only where needed to operate the service, comply with law, or protect legitimate interests.",
    ],
    bullets: [
      "Infrastructure, hosting, and database providers used to run the application and store operational data.",
      "Email delivery providers, such as Amazon SES, used to send and track messages.",
      "Billing and payment providers used to process purchases and subscription activity.",
      "Professional advisers, legal authorities, or counterparties when required for compliance, dispute resolution, or safety reasons.",
    ],
  },
  {
    title: "6. Retention",
    paragraphs: [
      "We keep personal data for as long as needed to provide the service, maintain records, resolve disputes, detect abuse, and satisfy legal or contractual requirements.",
      "Retention periods vary by data category. We may retain limited archived or backup copies for security, fraud prevention, or disaster recovery purposes.",
    ],
  },
  {
    title: "7. Security",
    paragraphs: [
      "We use reasonable technical and organizational measures designed to protect personal data. No system is completely secure, and you are responsible for protecting your credentials and limiting the data you upload to what is necessary for your use case.",
    ],
  },
  {
    title: "8. International processing",
    paragraphs: [
      "Send Again and its service providers may process data in multiple countries. Where required, we rely on appropriate contractual, technical, or legal mechanisms for cross-border transfers.",
    ],
  },
  {
    title: "9. Your rights and choices",
    paragraphs: [
      "Depending on your location, you may have rights to access, correct, delete, restrict, object to, or export certain personal data. You may also have the right to withdraw consent where processing is based on consent.",
      "To exercise those rights, use the contact details published on the website. We may need to verify your identity before completing a request.",
    ],
  },
  {
    title: "10. Policy updates and contact",
    paragraphs: [
      `This policy applies on and after ${LEGAL_LAST_UPDATED}. If we make material changes, we will update this page and revise the date shown above.`,
      <>
        Questions or privacy requests can be directed through{" "}
        <Link
          href="/"
          className="font-medium text-gray-900 underline underline-offset-4"
        >
          send-again.com
        </Link>
        .
      </>,
    ],
  },
];

export default function PrivacyPolicyPage() {
  return (
    <LegalPage
      title="Privacy Policy"
      summary="This policy explains what data Send Again handles, why it is processed, which providers are involved, and the choices available to users and uploaded contacts."
      sections={sections}
      lastUpdated={LEGAL_LAST_UPDATED}
    />
  );
}
