import test from "node:test";
import assert from "node:assert/strict";
import nacl from "tweetnacl";
import { blake2b } from "blakejs";
import { sealGitHubSecret } from "../lib/github-secrets.mjs";

test("GitHub Actions secret sealed box round-trips", () => {
  const recipient = nacl.box.keyPair();
  const message = "edge-gate-hmac-" + "x".repeat(32);
  const sealed = sealGitHubSecret(message, Buffer.from(recipient.publicKey).toString("base64"));
  const ephemeralPublicKey = sealed.subarray(0, 32);
  const ciphertext = sealed.subarray(32);
  const nonce = blake2b(new Uint8Array([...ephemeralPublicKey, ...recipient.publicKey]), null, 24);
  const opened = nacl.box.open(ciphertext, nonce, ephemeralPublicKey, recipient.secretKey);
  assert.ok(opened);
  assert.equal(Buffer.from(opened).toString("utf8"), message);
});
