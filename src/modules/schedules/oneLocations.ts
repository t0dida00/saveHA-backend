/**
 * Location names exactly as ONE lists them; its schedule page needs the name alongside the code.
 * Looked up with https://ecomm.one-line.com/api/v1/schedule/point-to-point/search?pointName=<name>
 */
export const ONE_LOCATIONS: Record<string, string> = {
  VNHPH: 'HAI PHONG, VIETNAM',
  // "VUT" (Vung Tau) in our sheets; ONE only lists the Cai Mep terminal there
  VNCMP: 'CAI MEP, VIETNAM',
  USLAX: 'LOS ANGELES, CA, UNITED STATES',
  USLGB: 'LONG BEACH, CA, UNITED STATES',
  USOAK: 'OAKLAND, CA, UNITED STATES',
  USTIW: 'TACOMA, WA, UNITED STATES',
  CAVAN: 'VANCOUVER, BC, CANADA',
  CAHAL: 'HALIFAX, NS, CANADA',
  USNYC: 'NEW YORK, NY, UNITED STATES',
  USSAV: 'SAVANNAH, GA, UNITED STATES',
  USJAX: 'JACKSONVILLE, FL, UNITED STATES',
  USORF: 'NORFOLK, VA, UNITED STATES',
  USCHS: 'CHARLESTON, SC, UNITED STATES',
  USHOU: 'HOUSTON, TX, UNITED STATES',
  USMOB: 'MOBILE, AL, UNITED STATES',
}
