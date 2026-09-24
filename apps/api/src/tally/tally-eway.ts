import { tag } from '../account-groups/tally-master.parser';

/** Tally stores the generated number inside EWayBillDetails, not on the voucher header. */
export function eWayBillNo(voucherXml: string): string | null {
  for (const [, details] of voucherXml.matchAll(/<EWAYBILLDETAILS\.LIST(?:\s[^>]*)?>([^]*?)<\/EWAYBILLDETAILS\.LIST>/g)) {
    if (tag(details, 'ISCANCELLED') === 'Yes') continue;
    const number = tag(details, 'BILLNUMBER');
    if (number) return number;
  }
  return null;
}
