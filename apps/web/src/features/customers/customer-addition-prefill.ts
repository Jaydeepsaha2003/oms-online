import type { CustomerAdditionDto, CustomerLookups } from '@oms/shared';

type AdditionSource = Pick<CustomerAdditionDto, 'tallyName' | 'groupName' | 'details'>;
type AdditionLookups = Pick<CustomerLookups, 'groups' | 'transporters'>;

const sameName = (a: string, b: string) => a.trim().toUpperCase() === b.trim().toUpperCase();

/** Values Tally can safely supply to the New Customer form. */
export function customerAdditionPrefill(
  addition: AdditionSource,
  lookups: AdditionLookups,
): Record<string, string> {
  const details = addition.details;
  const group = lookups.groups.find((item) => sameName(item.name, addition.groupName));
  const xmlTransportName = details.transportName?.trim() ?? '';
  const transporter = xmlTransportName
    ? lookups.transporters.find((item) => sameName(item.name, xmlTransportName))
    : undefined;

  return {
    partyName: addition.tallyName,
    ...(group ? { groupId: String(group.id) } : {}),
    ...(details.creditPeriod != null ? { creditPeriod: String(details.creditPeriod) } : {}),
    ...(details.state ? { state: details.state.toUpperCase() } : {}),
    ...(details.city ? { city: details.city.toUpperCase() } : {}),
    ...(details.mobile ? { mobile: details.mobile } : {}),
    ...(details.email ? { email: details.email } : {}),
    ...(xmlTransportName ? { transportName: transporter?.name ?? xmlTransportName.toUpperCase() } : {}),
    ...(transporter?.packing != null ? { packing: String(transporter.packing) } : {}),
    ...(transporter?.freight != null ? { freight: String(transporter.freight) } : {}),
  };
}
