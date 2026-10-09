// Pure consent gate (GLOSSARY: Consent). Customers without consent never receive messages.

export interface ConsentCarrier {
  consent: boolean;
  status: string; // CustomerStatus
}

export function canMessageCustomer(customer: ConsentCarrier): boolean {
  return customer.consent && customer.status === "active";
}

export function consentRefusalReason(customer: ConsentCarrier): string | null {
  if (customer.status !== "active") return "Customer is marked do-not-contact.";
  if (!customer.consent) return "Customer has not confirmed consent to be contacted.";
  return null;
}
