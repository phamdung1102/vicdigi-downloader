'use strict';

const fs = require('fs');
const path = require('path');

const {
  createLicensePayload,
  createLicenseToken,
} = require('../src/core/licensing/license-token');

function usage() {
  console.log('Usage: node scripts/generate-license-token.js <machineId> <days|lifetime> [customerName] [email]');
  console.log('Requires VICDIGI_LICENSE_PRIVATE_KEY_FILE or VICDIGI_LICENSE_PRIVATE_KEY_PEM.');
}

function getPrivateKey() {
  const inline = process.env.VICDIGI_LICENSE_PRIVATE_KEY_PEM;
  if (inline) return inline;

  const filePath = process.env.VICDIGI_LICENSE_PRIVATE_KEY_FILE;
  if (!filePath) throw new Error('Missing VICDIGI_LICENSE_PRIVATE_KEY_FILE');
  return fs.readFileSync(path.resolve(filePath), 'utf8');
}

function main() {
  const [machineId, durationArg, customerName = '', email = ''] = process.argv.slice(2);
  if (!machineId || !durationArg) {
    usage();
    process.exitCode = 1;
    return;
  }

  const payload = createLicensePayload({
    machineId,
    customerName,
    email,
    durationMode: durationArg === 'lifetime' ? 'lifetime' : 'days',
    days: durationArg === 'lifetime' ? undefined : Number(durationArg || 0),
  });
  console.log(createLicenseToken(payload, getPrivateKey()));
}

main();
