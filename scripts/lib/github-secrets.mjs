import nacl from "tweetnacl";
import { blake2b } from "blakejs";

export function sealGitHubSecret(value, publicKeyBase64) {
  const recipient = Buffer.from(String(publicKeyBase64), "base64");
  if (recipient.length !== nacl.box.publicKeyLength) {
    throw new Error("invalid GitHub Actions public key");
  }
  const message = Buffer.from(String(value), "utf8");
  const ephemeral = nacl.box.keyPair();
  const nonce = blake2b(new Uint8Array([...ephemeral.publicKey, ...recipient]), null, 24);
  const ciphertext = nacl.box(message, nonce, recipient, ephemeral.secretKey);
  return Buffer.concat([Buffer.from(ephemeral.publicKey), Buffer.from(ciphertext)]);
}
