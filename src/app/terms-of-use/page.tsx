import type { Metadata } from "next";
import Link from "next/link";
import {
  LEGAL_LAST_UPDATED,
  LegalPage,
  type LegalSection,
} from "@/components/legal-page";

export const metadata: Metadata = {
  title: "Terms of Use | Send Again",
  description:
    "Terms of Use for Send Again, covering access, acceptable use, billing, and email compliance responsibilities.",
};

const sections: LegalSection[] = [
  {
    title: "1. Acceptance",
    paragraphs: [
      "These Terms of Use govern your access to and use of Send Again, including the web application, APIs, and related services.",
      "By creating an account, using the service, or sending email through Send Again, you agree to these terms and to the Privacy Policy. If you use Send Again for a business or organization, you confirm that you can bind that entity to these terms.",
    ],
  },
  {
    title: "2. Eligibility and accounts",
    paragraphs: [
      "You must provide accurate account information and keep your credentials confidential. You are responsible for all activity under your account.",
      "You may not share access in a way that bypasses intended user limits, attempt to gain unauthorized access to other accounts or systems, or use Send Again if your access has been suspended or terminated.",
    ],
  },
  {
    title: "3. Email compliance and acceptable use",
    paragraphs: [
      "Send Again is an email infrastructure and campaign platform. You are responsible for the content you send, the recipients you contact, and your compliance with applicable laws, regulations, and industry rules.",
    ],
    bullets: [
      "Only send to recipients where you have a valid legal basis and any required consent.",
      "Honor unsubscribe requests, suppression lists, and recipient preferences.",
      "Do not send spam, phishing, malware, deceptive content, or unlawful material.",
      "Do not use purchased, scraped, or otherwise unauthorized contact lists.",
      "Do not attempt to interfere with deliverability systems, rate limits, abuse controls, or platform security.",
    ],
  },
  {
    title: "4. Customer data and contacts",
    paragraphs: [
      "You retain responsibility for the contacts, templates, campaign content, and other data you upload or send through the service.",
      "You represent that you have all rights and permissions needed to use that data with Send Again, including any rights needed for tracking, personalisation, and email delivery.",
    ],
  },
  {
    title: "5. Service availability and changes",
    paragraphs: [
      "We may update, improve, suspend, or discontinue parts of Send Again at any time. We may also set or enforce limits related to throughput, storage, features, or account security.",
      "We aim to operate the service reliably, but we do not guarantee uninterrupted availability, inbox placement, delivery rates, or compatibility with every downstream email provider.",
    ],
  },
  {
    title: "6. Billing and paid usage",
    paragraphs: [
      "Paid features, credit packs, and other billable usage are charged according to the pricing presented in the product or checkout flow on the date of purchase.",
      "Unless otherwise stated, fees are non-refundable once credits are granted or the paid service has been provisioned. You are responsible for taxes, chargebacks, and payment method accuracy.",
    ],
  },
  {
    title: "7. Intellectual property",
    paragraphs: [
      "Send Again and its related branding, software, and service materials remain the property of their respective owners and licensors.",
      "You keep ownership of your content. You grant us the limited rights needed to host, process, transmit, display, and secure your data solely to operate and improve the service.",
    ],
  },
  {
    title: "8. Suspension and termination",
    paragraphs: [
      "We may suspend or terminate access if we reasonably believe your use creates legal, deliverability, payment, or security risk, or if you materially breach these terms.",
      "You may stop using the service at any time. Provisions that by their nature should survive termination, including payment obligations, disclaimers, liability limits, and compliance responsibilities, continue after termination.",
    ],
  },
  {
    title: "9. Disclaimers and liability limits",
    paragraphs: [
      "Send Again is provided on an \"as is\" and \"as available\" basis to the maximum extent permitted by law. We disclaim implied warranties, including merchantability, fitness for a particular purpose, and non-infringement.",
      "To the maximum extent permitted by law, Send Again will not be liable for indirect, incidental, special, consequential, exemplary, or lost-profit damages, or for any loss of data, goodwill, business, or deliverability arising from or related to your use of the service.",
      "If applicable law does not allow some of these limits, liability is limited to the greatest extent permitted and, in any event, to the amounts you paid to Send Again for the service in the 12 months before the event giving rise to the claim.",
    ],
  },
  {
    title: "10. Contact",
    paragraphs: [
      <>
        Questions about these terms can be directed through{" "}
        <Link
          href="/"
          className="font-medium text-gray-900 underline underline-offset-4"
        >
          send-again.com
        </Link>
        .
      </>,
      `These terms apply on and after ${LEGAL_LAST_UPDATED}. We may update them from time to time, and the updated version will be posted on this page with a new effective date.`,
    ],
  },
];

export default function TermsOfUsePage() {
  return (
    <LegalPage
      title="Terms of Use"
      summary="These terms set the rules for using Send Again, including account responsibilities, sending compliance, billing, and service limitations."
      sections={sections}
      lastUpdated={LEGAL_LAST_UPDATED}
    />
  );
}
