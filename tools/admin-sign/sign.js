const fs = require('fs');
const path = require('path');

// Ensure we run on a modern Node.js which has globalThis.crypto
const webcrypto = globalThis.crypto || require('crypto').webcrypto;
if (!webcrypto || !webcrypto.subtle) {
  console.error('Error: WebCrypto API not available. Please upgrade Node.js.');
  process.exit(1);
}

const KEY_FILE = path.join(__dirname, 'private-key.json');
const SEQ_FILE = path.join(__dirname, 'seq.json');

async function keygen() {
  console.log('Generating Ed25519 keypair...');
  const keyPair = await webcrypto.subtle.generateKey(
    { name: 'Ed25519', namedCurve: 'Ed25519' },
    true,
    ['sign', 'verify']
  );

  // Export private key to save locally (jwk format is easy to read/write as JSON)
  const privateJwk = await webcrypto.subtle.exportKey('jwk', keyPair.privateKey);
  fs.writeFileSync(KEY_FILE, JSON.stringify(privateJwk, null, 2), 'utf8');

  // Export public key as raw bytes (32 bytes) for copying into userscript
  const publicRaw = await webcrypto.subtle.exportKey('raw', keyPair.publicKey);
  const bytes = Array.from(new Uint8Array(publicRaw));
  
  console.log('\nKeypair generated successfully!');
  console.log(`Private key saved to: ${KEY_FILE}`);
  console.log('\n--- Paste the following into warera-prost.user.js in ADMIN_PUBKEYS ---');
  console.log(`Uint8Array.from([${bytes.join(', ')}])`);
  console.log('------------------------------------------------------------------------\n');
}

async function sign(payload, kid = 'beertierchen') {
  if (!fs.existsSync(KEY_FILE)) {
    console.error(`Error: Private key file not found at ${KEY_FILE}. Run "node sign.js keygen" first.`);
    process.exit(1);
  }

  // Load private key
  const jwk = JSON.parse(fs.readFileSync(KEY_FILE, 'utf8'));
  const privateKey = await webcrypto.subtle.importKey(
    'jwk',
    jwk,
    { name: 'Ed25519', namedCurve: 'Ed25519' },
    true,
    ['sign']
  );

  // Get next seq
  let seq = 1;
  if (fs.existsSync(SEQ_FILE)) {
    try {
      const seqData = JSON.parse(fs.readFileSync(SEQ_FILE, 'utf8'));
      if (typeof seqData.seq === 'number') {
        seq = seqData.seq + 1;
      }
    } catch (e) {}
  }

  const ts = Date.now();
  const msgText = `${payload}|${ts}|${seq}`;
  const data = new TextEncoder().encode(msgText);

  // Sign message
  const signatureBuffer = await webcrypto.subtle.sign(
    { name: 'Ed25519' },
    privateKey,
    data
  );

  // Convert signature to base64
  const sig = Buffer.from(signatureBuffer).toString('base64');

  // Save new seq
  fs.writeFileSync(SEQ_FILE, JSON.stringify({ seq }), 'utf8');

  const envelope = {
    payload,
    ts,
    seq,
    kid,
    sig
  };

  console.log('\nEnvelope signed successfully!');
  console.log(JSON.stringify(envelope, null, 2));
  console.log('\nCommand to post to ntfy:');
  console.log(`curl -d '${JSON.stringify(envelope)}' https://ntfy.sh/bumblebee-goodboy`);
  console.log();
}

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  if (command === 'keygen') {
    await keygen();
  } else if (command === 'sign') {
    const payload = args[1];
    const kid = args[2] || 'beertierchen';
    if (!payload) {
      console.log('Usage: node sign.js sign "<message>" [kid]');
      process.exit(1);
    }
    await sign(payload, kid);
  } else {
    console.log('Ed25519 Signing CLI for PROST');
    console.log('Usage:');
    console.log('  node sign.js keygen                  Generate new keypair');
    console.log('  node sign.js sign "<message>" [kid]  Sign a message');
    process.exit(1);
  }
}

main().catch(console.error);
