/** Wake-on-LAN magic packet: six 0xFF bytes, then the MAC address sixteen times. */
export function magicPacket(mac: string): Buffer {
  const hex = mac.replace(/[^0-9a-f]/gi, '');
  if (!/^[0-9a-f]{12}$/i.test(hex)) throw new Error(`Not a MAC address: ${mac}`);
  return Buffer.concat([Buffer.alloc(6, 0xff), ...Array.from({ length: 16 }, () => Buffer.from(hex, 'hex'))]);
}
