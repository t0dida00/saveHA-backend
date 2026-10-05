export interface OneServiceRoute {
  service: string
  /** Route as written in our sheet; becomes the column header */
  route: string
  /** First origin and first destination of the route, which is what we search ONE for */
  origin: string
  destination: string
}

// VUT is searched as Cai Mep (VNCMP), HAF/HAL as Halifax (CAHAL)
export const ONE_SERVICE_ROUTES: OneServiceRoute[] = [
  { service: 'PS7', route: 'HPH/VUT - LAX/LGB/OAK', origin: 'VNHPH', destination: 'USLAX' },
  { service: 'MS2', route: 'VUT - LGB/OAK', origin: 'VNCMP', destination: 'USLGB' },
  { service: 'PS3', route: 'VUT/HPH - LAX/LGB/OAK', origin: 'VNCMP', destination: 'USLAX' },
  // { service: 'AP1', route: 'HPH/VUT - LAX/OAK', origin: 'VNHPH', destination: 'USLAX' },
  // { service: 'PN2', route: 'VUT - TIW/VAN', origin: 'VNCMP', destination: 'USTIW' },
  { service: 'VSE', route: 'VUT/HPH - LAX/LGB', origin: 'VNCMP', destination: 'USLAX' },
  { service: 'FP2', route: 'VUT/HPH - VAN/TIW', origin: 'VNCMP', destination: 'CAVAN' },
  // { service: 'PN3', route: 'HPH - VAN/TIW', origin: 'VNHPH', destination: 'CAVAN' },
  // { service: 'EC5', route: 'VUT - HAF/NYC/SAV/JAK/ORF/CHS', origin: 'VNCMP', destination: 'CAHAL' },
  { service: 'EC3', route: 'VUT - ORF/CHS/SAV/NYC/JAX', origin: 'VNCMP', destination: 'USORF' },
  { service: 'EC2', route: 'VUT - ORF/CHS/SAV/NYC/HAL', origin: 'VNCMP', destination: 'USORF' },
  { service: 'EC4', route: 'VUT - HOU/MOB', origin: 'VNCMP', destination: 'USHOU' },
]
