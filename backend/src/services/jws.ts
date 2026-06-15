import { X509Certificate, verify as cryptoVerify } from 'node:crypto';
import { receiptValidationFailed, storeProblem } from '../errors.js';

/** Apple signs StoreKit payloads and App Store Server Notifications as ES256 JWS with an x5c chain. */

export function b64urlToBuffer(s: string): Buffer {
  return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

/** Decodes a JWS payload segment WITHOUT verifying the signature. */
export function decodeJwsPayload<T>(jws: string): T {
  const parts = jws.split('.');
  if (parts.length !== 3) {
    throw receiptValidationFailed('Value is not a valid JWS (expected 3 segments).');
  }
  return JSON.parse(b64urlToBuffer(parts[1]!).toString('utf8')) as T;
}

function certFromX5c(b64: string): X509Certificate {
  return new X509Certificate(Buffer.from(b64, 'base64'));
}

/**
 * Verifies an Apple ES256 JWS: checks the signature with the leaf cert, validates the
 * x5c chain links and validity windows, and — when `rootCaPem` is given — pins the chain
 * to Apple's root CA. Returns the decoded payload. Throws on any failure.
 */
export function verifyAppleJws<T>(jws: string, rootCaPem?: string): T {
  const parts = jws.split('.');
  if (parts.length !== 3) {
    throw receiptValidationFailed('Apple JWS is malformed (expected 3 segments).');
  }
  const [headerB64, payloadB64, signatureB64] = parts as [string, string, string];

  let header: { alg?: string; x5c?: string[] };
  try {
    header = JSON.parse(b64urlToBuffer(headerB64).toString('utf8'));
  } catch {
    throw receiptValidationFailed('Could not decode Apple JWS header.');
  }
  if (header.alg !== 'ES256' || !header.x5c?.length) {
    throw receiptValidationFailed('Apple JWS must be ES256-signed with an x5c chain.');
  }

  const chain = header.x5c.map(certFromX5c);
  verifyChain(chain, rootCaPem);

  const leaf = chain[0]!;
  const ok = cryptoVerify(
    'sha256',
    Buffer.from(`${headerB64}.${payloadB64}`),
    { key: leaf.publicKey, dsaEncoding: 'ieee-p1363' },
    b64urlToBuffer(signatureB64),
  );
  if (!ok) throw receiptValidationFailed('Apple JWS signature is invalid.');

  return JSON.parse(b64urlToBuffer(payloadB64).toString('utf8')) as T;
}

function verifyChain(chain: X509Certificate[], rootCaPem?: string): void {
  const now = Date.now();
  for (const cert of chain) {
    if (new Date(cert.validFrom).getTime() > now || new Date(cert.validTo).getTime() < now) {
      throw receiptValidationFailed('An Apple certificate in the chain is expired or not yet valid.');
    }
  }
  for (let i = 0; i < chain.length - 1; i++) {
    if (!chain[i]!.verify(chain[i + 1]!.publicKey)) {
      throw receiptValidationFailed('Apple certificate chain is broken.');
    }
  }
  const root = chain[chain.length - 1]!;
  if (rootCaPem) {
    let pinned: X509Certificate;
    try {
      pinned = new X509Certificate(rootCaPem);
    } catch {
      throw storeProblem('APPLE_ROOT_CA_PEM is not a valid certificate.');
    }
    if (root.fingerprint256 !== pinned.fingerprint256) {
      throw receiptValidationFailed('Apple chain does not terminate at the pinned Apple root CA.');
    }
  }
}
