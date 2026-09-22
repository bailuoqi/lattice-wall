import { isIP } from 'node:net';

const localHostnameSuffixes = ['.home.arpa', '.internal', '.lan', '.local', '.localdomain', '.localhost'];

const ipv4Number = (address) => {
  if (isIP(address) !== 4) return null;
  const octets = address.split('.').map(Number);
  return (((octets[0] << 24) >>> 0) + (octets[1] << 16) + (octets[2] << 8) + octets[3]) >>> 0;
};

const inIpv4Cidr = (address, base, prefixLength) => {
  const baseAddress = ipv4Number(base);
  if (baseAddress === null) return false;
  const mask = prefixLength === 0 ? 0 : (0xffffffff << (32 - prefixLength)) >>> 0;
  return ((address & mask) >>> 0) === ((baseAddress & mask) >>> 0);
};

const blockedIpv4Ranges = [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8],
  ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24],
  ['192.88.99.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24],
  ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
];

export const isPublicWorkshopHost = (value) => {
  const host = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (!host || host.length > 253 || host === 'localhost' || host.includes('%')
    || host.includes('://') || host.includes('/') || host.includes(':') || host.includes('*')
    || host.startsWith('.') || host.endsWith('.')) return false;
  const numeric = ipv4Number(host);
  if (numeric !== null) {
    return !blockedIpv4Ranges.some(([base, prefixLength]) => inIpv4Cidr(numeric, base, prefixLength));
  }
  if (isIP(host) !== 0 || !host.includes('.') || host.split('.').some((label) => (
    !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u.test(label)
  ))) return false;
  if (localHostnameSuffixes.some((suffix) => host.endsWith(suffix))) return false;
  try {
    return new URL(`https://${host}`).hostname === host;
  } catch {
    return false;
  }
};

export const normalizeWorkshopNetworkHosts = (value) => {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 32) throw new Error('Workshop networkHosts are invalid');
  const hosts = value.map((entry) => typeof entry === 'string' ? entry.trim().toLowerCase() : '');
  if (hosts.some((host) => !isPublicWorkshopHost(host)) || new Set(hosts).size !== hosts.length) {
    throw new Error('Workshop networkHosts are invalid');
  }
  return hosts;
};

export const validateWorkshopNetworkDeclaration = (manifest, packageValue) => {
  const hosts = normalizeWorkshopNetworkHosts(manifest?.networkHosts);
  if (manifest?.content?.kind !== 'plugin-package' && hosts.length > 0) {
    throw new Error('Only plug-in packages may declare networkHosts');
  }
  const permissions = new Set(Array.isArray(packageValue?.manifest?.permissions) ? packageValue.manifest.permissions : []);
  if (permissions.has('network:request') && hosts.length === 0) {
    throw new Error('network:request requires fixed networkHosts on the outer manifest');
  }
  if (hosts.length > 0 && !permissions.has('network:request') && !permissions.has('playback:share')) {
    throw new Error('networkHosts require network:request or playback:share');
  }
  return hosts;
};

export const assertWorkshopMockUrl = (value, declaredHosts, errorCode = 'network-url-invalid') => {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(errorCode);
  }
  if ((url.protocol !== 'https:' && url.protocol !== 'http:') || url.username || url.password) {
    throw new Error(errorCode === 'share-destination-denied' ? errorCode : 'network-url-unsupported');
  }
  if (url.port) throw new Error(errorCode === 'share-destination-denied' ? errorCode : 'network-port-denied');
  if (!declaredHosts.includes(url.hostname.toLowerCase())) {
    throw new Error(errorCode === 'share-destination-denied' ? errorCode : 'network-host-denied');
  }
  if (!isPublicWorkshopHost(url.hostname)) {
    throw new Error(errorCode === 'share-destination-denied' ? errorCode : 'network-address-denied');
  }
  return url;
};
